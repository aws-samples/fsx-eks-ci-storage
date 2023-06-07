import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {EksCluster} from './eks-cluster'
import {FsxLFilesystem} from './fsx-filesystem'
import {StackOptions} from "./types"
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3'
import {RemovalPolicy} from "aws-cdk-lib";

export class EksCiCdStorageStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: StackOptions) {
        super(scope, id, props);

        const cluster = new EksCluster(this, 'eksCluster', {
            name: "EKS-CiCd-Storage",
            eksKubernetesVersion: props.eksKubernetesVersion,
            ec2InstanceType: props.ec2InstanceType,
            ec2InstanceCount: props.ec2InstanceCount,
            ec2InstanceStorageGb: props.ec2InstanceStorageGb,
            helmChartVersions: props.helmChartVersions,
            account: this.account,
            region: this.region
        })

        // Bucket for Direct To S3 Testing with permissions attached to the node-group.
        const directToS3Bucket = new s3.Bucket(this, "directToS3Bucket", {
            removalPolicy: RemovalPolicy.RETAIN
        })
        cluster.nodeGroup.role.attachInlinePolicy(new iam.Policy(this, 'directToS3Permissions', {
            policyName: 'directToS3Permissions',
            statements: [new iam.PolicyStatement({
                actions: [ "s3:List*", "s3:PutObject*", "s3:GetObject*", "s3:DeleteObject*"],
                resources: [ directToS3Bucket.bucketArn, directToS3Bucket.arnForObjects('*') ],
                effect: iam.Effect.ALLOW
            })]
        }))

        const fsx = new FsxLFilesystem(this, 'FsxLFilesystem', {
            vpc: cluster.cluster.vpc,
            fsxStorageSizeGb: props.fsxStorageSizeGb,
            fsxThroughputPerTb: props.fsxThroughputPerTb,
            sgToPermit: cluster.cluster.clusterSecurityGroup
        })

        // Helm Charts
        cluster.ebsCsiHelm()
        cluster.fsxCsiHelm()
        cluster.prometheusOperatorHelm()
        cluster.grafanaHelm()

        for(const namespace of ["ebs-backed-workspace", "memory-backed-workspace", "workspace-to-fsx", "workspace-direct-to-s3"]) {
            cluster.addManifestCreateNamespace(namespace)
        }

        cluster.addManifestConfigMap("workspace-direct-to-s3", "s3-deployment-info", {
            bucketName: directToS3Bucket.bucketName,
        })

        cluster.addManifestConfigMap("workspace-to-fsx", "fsx-deployment-info", {
            filesystemId: fsx.fsxFilesystem.fileSystemId,
            filesystemDnsName: fsx.fsxFilesystem.dnsName,
            filesystemMountName: fsx.fsxFilesystem.mountName,
            replicationBucket: fsx.fsxReplicationBucket.bucketName
        })

        // This approach assures the order of application since some manifests depend on each other.
        cluster.applyManifests()
    }
}
