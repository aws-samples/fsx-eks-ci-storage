import * as k8s from "@kubernetes/client-node"
import {jobUuids, parsePodCount} from "./util"

const createBuildPodEbs = async (k8sapi: k8s.CoreV1Api, namespace: string, jobUuid: string) => {
    const cloneAlzCommands = [
        "cd /workspace/",
        "git clone https://github.com/awslabs/landing-zone-accelerator-on-aws.git",
    ]
    const buildAlzCommands = [
        `cd /workspace/landing-zone-accelerator-on-aws/source`,
        `yarn config set cache-folder /workspace/.yarncache`,
        `yarn install`,
        `yarn build`,
        `touch /workspace/finished`,
    ];
    const saveWorkspaceToS3Commands = [
        `dnf -y --disablerepo '*' --enablerepo=extras swap centos-linux-repos centos-stream-repos`,
        `yum -yq install unzip`,
        `curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"`,
        `unzip awscliv2.zip`,
        `./aws/install`,
        `rm -f awscliv2.zip`,
        `rm -rf /aws/`,
        `while ! test -f /workspace/finished ; do sleep 1; done`,
        `rm -f  /workspace/finished`,
        `time tar -zcf /workspace/workspace-${jobUuid}.tar.gz /workspace/*`,
        `time aws s3 cp /workspace/workspace-${jobUuid}.tar.gz s3://\${S3_BUCKET}/workspaces/`
    ]

    return k8sapi.createNamespacedPod(namespace, {
        metadata: {
            name: `${namespace}-${jobUuid}`,
            namespace: namespace
        },
        spec: {
            restartPolicy: "OnFailure",
            initContainers: [
                {
                    name: "retrieve-code-from-github",
                    image: "public.ecr.aws/bitnami/git:latest",
                    workingDir: "/workspace",
                    command: [
                        "/bin/sh",
                        "-c",
                        cloneAlzCommands.join(";")
                    ],
                    volumeMounts: [
                        {
                            mountPath: "/workspace",
                            name: "workspace"
                        }
                    ],
                    resources: {
                        requests: {
                            cpu: "100m",
                            memory: "256Mi"
                        }
                    }
                },
            ],
            containers: [
                {
                    name: "build-alz",
                    image: "public.ecr.aws/bitnami/node:16",
                    workingDir: "/workspace",
                    command: [
                        "/bin/sh",
                        "-c",
                        buildAlzCommands.join(";")
                    ],
                    resources: {
                        requests: {
                            cpu: "1000m",
                            memory: "6144Mi",
                            'ephemeral-storage': "5Gi"
                        }
                    },
                    volumeMounts: [
                        {
                            mountPath: "/workspace",
                            name: "workspace"
                        }
                    ]
                },
                {
                    name: "backup-workspace",
                    image: "public.ecr.aws/docker/library/centos",
                    workingDir: "/workspace",
                    command: [
                        "/bin/sh",
                        "-c",
                        saveWorkspaceToS3Commands.join(";")
                    ],
                    env: [{
                        name: "S3_BUCKET",
                        valueFrom: {
                            configMapKeyRef: {
                                name: "s3-deployment-info",
                                key: "bucketName"
                            }
                        }
                    }],
                    resources: {
                        requests: {
                            cpu: "100m",
                            memory: "256Mi"
                        }
                    },
                    volumeMounts: [
                        {
                            mountPath: "/workspace",
                            name: "workspace"
                        }
                    ]
                }
            ],
            volumes: [{
                name: "workspace",
                emptyDir: {
                    sizeLimit: "5Gi",
                    medium: "Memory"
                }
            }]
        }
    })
}


(async () => {

    const kc = new k8s.KubeConfig();
    kc.loadFromDefault({
    });
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    try {
        const namespace = "workspace-direct-to-s3"
        const uuidsForJobs = jobUuids.slice(0, parsePodCount())

        const pods: Array<Promise<any>> = []
        uuidsForJobs.forEach((jobUuid) => {
            pods.push(createBuildPodEbs(k8sApi, namespace, jobUuid))
        })
        // Submit all the pods at once
        Promise.all(pods).then(() => {})

    } catch (e) {
        console.error(e)
    }
})()