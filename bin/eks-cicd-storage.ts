#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EksCiCdStorageStack } from '../lib/eks-cicd-storage-stack';
import * as eks from "aws-cdk-lib/aws-eks";
import * as ec2 from "aws-cdk-lib/aws-ec2";

const app = new cdk.App();
new EksCiCdStorageStack(app, 'EksCiCdStorage', {
    eksKubernetesVersion: eks.KubernetesVersion.V1_26,
    ec2InstanceType: ec2.InstanceType.of(ec2.InstanceClass.MEMORY6_AMD, ec2.InstanceSize.XLARGE8),
    ec2InstanceCount: 1,
    ec2InstanceStorageGb: 1000,
    fsxStorageSizeGb: 1200,
    fsxThroughputPerTb: 500,
    helmChartVersions: {
        ebsCsi: "2.17.1",
        fsxCsi: "1.5.0",
        grafana: "6.51.5",
        promOperator: "8.3.12"
    }
});