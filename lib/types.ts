import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks'
import * as cdk from 'aws-cdk-lib'

export interface helmChartVersions {
    ebsCsi: string
    fsxCsi: string
    grafana: string
    promOperator: string
}

export interface StackOptions extends cdk.StackProps {
    eksKubernetesVersion: eks.KubernetesVersion
    ec2InstanceType: ec2.InstanceType
    ec2InstanceCount: number
    ec2InstanceStorageGb: number
    fsxStorageSizeGb: number
    fsxThroughputPerTb: number
    helmChartVersions: helmChartVersions
}