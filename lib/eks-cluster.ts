import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { KubectlV26Layer } from '@aws-cdk/lambda-layer-kubectl-v26';
import * as iam from "aws-cdk-lib/aws-iam";
import * as ebsIamPolicyJson from "./ebsCsiIamPolicy.json"
import * as grafanaDashboard from "../grafana/pod-duration-dashboard.json"
import { helmChartVersions } from "./types"

export interface IEksCluster {
    name: string
    eksKubernetesVersion: eks.KubernetesVersion
    ec2InstanceType: ec2.InstanceType
    ec2InstanceCount: number
    ec2InstanceStorageGb: number
    helmChartVersions: helmChartVersions
    account: string
    region: string
}

export class EksCluster extends Construct {
    props: IEksCluster
    clusterAccessRole: iam.Role
    cluster: eks.Cluster
    nodeGroup: eks.Nodegroup
    manifests: Array<Record<string, any>> = []
    ebsCsi: eks.HelmChart
    fsxCsi: eks.HelmChart

    constructor(scope: Construct, id: string, props: IEksCluster) {
        super(scope, id);
        this.props = props

        this.clusterAccessRole = new iam.Role(this, `${id}-EksClusterAccessRole`, {
            roleName: `${this.props.name}-acccess-role-${props.region}`,
            assumedBy: new iam.AccountPrincipal(props.account),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("ReadOnlyAccess")
            ]
        })

        this.cluster =  new eks.Cluster(this, 'EksCluster', {
            version: this.props.eksKubernetesVersion,
            clusterName: this.props.name,
            defaultCapacity: 0,
            kubectlLayer: new KubectlV26Layer(this, 'KubectlV26Layer'),
            mastersRole: this.clusterAccessRole,
            outputMastersRoleArn: true
        });

        this.nodeGroup = this.cluster.addNodegroupCapacity('eksCiCdNodeGroup', {
            instanceTypes: [ this.props.ec2InstanceType ],
            desiredSize: this.props.ec2InstanceCount,
            diskSize: this.props.ec2InstanceStorageGb
        })

        // So we can SSM to our instance
        this.nodeGroup.role.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
        )
    }
    fsxCsiHelm() {
        this.fsxCsi = new eks.HelmChart(this, 'fsxCsiDriverHelm', {
            cluster: this.cluster,
            chart: 'aws-fsx-csi-driver',
            release: 'aws-fsx-csi-driver',
            repository: 'https://kubernetes-sigs.github.io/aws-fsx-csi-driver/',
            version: this.props.helmChartVersions.fsxCsi,
            values: {
                controller: {
                    replicaCount: this.props.ec2InstanceCount
                }
            }
        });
    }
    ebsCsiHelm() {
        const ebsCsiServiceAccount = this.cluster.addServiceAccount('ebsCsiServiceAccount', {})
        ebsCsiServiceAccount.role.attachInlinePolicy(new iam.Policy(this, 'ebsCsiPolicy', {
            policyName: "ebsCsiPolicy",
            statements: ebsIamPolicyJson.Statement.map((statement) => {return iam.PolicyStatement.fromJson(statement)})
        }))

        this.ebsCsi = new eks.HelmChart(this, 'ebsCsiDriverHelm', {
            cluster: this.cluster,
            chart: 'aws-ebs-csi-driver',
            release: 'aws-ebs-csi-driver',
            repository: 'https://kubernetes-sigs.github.io/aws-ebs-csi-driver',
            version: this.props.helmChartVersions.ebsCsi,
            values: {
                controller: {
                    replicaCount: 1,
                    serviceAccount: {
                        create: false,
                        name: ebsCsiServiceAccount.serviceAccountName
                    }
                },
                storageClasses: [
                    {
                        name: "ebs-sc",
                        annotations: {
                            "storageclass.kubernetes.io/is-default-class": "true"
                        },
                        volumeBindingMode: "WaitForFirstConsumer",
                        reclaimPolicy: "Delete"
                    }
                ]
            }
        });
    }
    prometheusOperatorHelm() {
        const promHelm = new eks.HelmChart(this, 'prometheusOperatorHelm', {
            cluster: this.cluster,
            chart: 'kube-prometheus',
            release: 'kube-prometheus',
            repository: 'https://charts.bitnami.com/bitnami',
            version: this.props.helmChartVersions.promOperator,
            namespace: "monitoring",
            values: {
                global: {
                    storageClass: "ebs-sc"
                },
                prometheus: {
                    persistence: {
                        enabled: true
                    }
                }
            }
        });
        promHelm.node.addDependency(this.ebsCsi)
    }
    grafanaHelm() {
        const grafanaHelm = new eks.HelmChart(this, 'grafanaHelm', {
            cluster: this.cluster,
            chart: 'grafana',
            release: 'grafana',
            repository: 'https://grafana.github.io/helm-charts',
            namespace: "monitoring",
            version: this.props.helmChartVersions.grafana,
            values: {
                persistence: {
                    enabled: true,
                    storageClassName: "ebs-sc"
                },
                datasources: {
                    "datasources.yaml": {
                        apiVersion: 1,
                        datasources: [{
                            name: "Prometheus",
                            type: "prometheus",
                            url: "http://prometheus-operated:9090",
                            isDefault: true
                        }]
                    }
                },
                dashboardProviders: {
                    "dashboardproviders.yaml": {
                        apiVersion: 1,
                        providers: [{
                            name: "default",
                            orgId: 1,
                            folder: 'examples',
                            type: 'file',
                            disableDeletion: false,
                            editable: true,
                            options: {
                                path: "/var/lib/grafana/dashboards/default"
                            }
                        }]
                    }
                },
                dashboards: {
                    default: {
                        "pod-execution-times": {
                            json: JSON.stringify(grafanaDashboard)
                        }
                    }
                }
            }
        });
        grafanaHelm.node.addDependency(this.ebsCsi)
    }
    addManifestCreateNamespace(namespace: string) {
        this.manifests.push(
            {
                apiVersion: "v1",
                kind: "Namespace",
                metadata: {
                    name: namespace
                }
            }
        )
    }
    addManifestConfigMap(namespace: string, name: string, data: Record<string, any>) {
        this.manifests.push(
            {
                apiVersion: "v1",
                kind: "ConfigMap",
                metadata: {
                    name: name,
                    namespace: namespace
                },
                data: data
            }
        )
    }
    applyManifests() {
        this.cluster.addManifest(`clusterManifests`, ...this.manifests)
    }
}
