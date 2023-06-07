import {Construct} from 'constructs';
import * as fsx from 'aws-cdk-lib/aws-fsx';
import {LustreDataCompressionType} from 'aws-cdk-lib/aws-fsx';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3'
import {RemovalPolicy} from "aws-cdk-lib";
import * as cdk from 'aws-cdk-lib';

export interface IFsxLFilesystem {
    vpc: ec2.IVpc
    fsxStorageSizeGb: number
    fsxThroughputPerTb: number
    sgToPermit: ec2.ISecurityGroup
}

export class FsxLFilesystem extends Construct {
    props: IFsxLFilesystem
    fsxFilesystem: fsx.LustreFileSystem
    fsxReplicationBucket: s3.Bucket
    fsxFilesystemDra: fsx.CfnDataRepositoryAssociation
    fsxSecurityGroup: ec2.SecurityGroup

    constructor(scope: Construct, id: string, props: IFsxLFilesystem ) {
        super(scope, id);
        this.props = props

        this.fsxReplicationBucket = new s3.Bucket(this, "fsxReplicationBucket", {
            removalPolicy: RemovalPolicy.RETAIN
        })

        this.fsxSecurityGroup = new ec2.SecurityGroup(this, 'fsxFilesystemSecurityGroup', {
            allowAllOutbound: true,
            vpc: this.props.vpc,
            description: "Allow Access from EKS Cluster nodes to FsxL Filesystem"
        })

        this.fsxSecurityGroup.addIngressRule(
            ec2.Peer.securityGroupId(this.props.sgToPermit.securityGroupId),
            ec2.Port.tcp(988),
            'Permit communication with FsxL'
        )
        this.fsxSecurityGroup.addIngressRule(
            ec2.Peer.securityGroupId(this.props.sgToPermit.securityGroupId),
            ec2.Port.tcpRange(1018, 1023),
            'Permit communication with FsxL'
        )

        this.fsxFilesystem =  new fsx.LustreFileSystem(this, 'fsxFilesystem', {
            vpc: this.props.vpc,
            vpcSubnet: this.props.vpc.privateSubnets[0],
            securityGroup: this.fsxSecurityGroup,
            storageCapacityGiB: this.props.fsxStorageSizeGb,
            lustreConfiguration: {
                deploymentType: fsx.LustreDeploymentType.PERSISTENT_2,
                perUnitStorageThroughput: this.props.fsxThroughputPerTb,
                dataCompressionType: LustreDataCompressionType.LZ4
            },
            removalPolicy: RemovalPolicy.DESTROY
        });
        this.fsxFilesystem.node.addDependency(this.fsxSecurityGroup)

        this.fsxFilesystemDra = new fsx.CfnDataRepositoryAssociation(this, 'fsxFilesystemDRA', {
            dataRepositoryPath: this.fsxReplicationBucket.s3UrlForObject(),
            fileSystemId: this.fsxFilesystem.fileSystemId,
            fileSystemPath: '/outputs/',
            s3: {
                autoExportPolicy: {
                    events: [ "NEW", "CHANGED", "DELETED" ]
                },
                autoImportPolicy: {
                    events: [ "NEW", "CHANGED", "DELETED" ]
                }
            }
        })
        this.fsxFilesystemDra.node.addDependency(this.fsxFilesystemDra)

        new cdk.CfnOutput(this, 'FsxOutputBucket', {
            description: "Bucket to look for test results written to by FSxL Data Replication",
            value: this.fsxReplicationBucket.bucketName
        })
    }
}
