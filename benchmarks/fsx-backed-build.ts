import * as k8s from "@kubernetes/client-node"
import {jobUuids, createPv, createPvc, parsePodCount} from "./util"

const createBuildPodFSx = async (k8sapi: k8s.CoreV1Api, namespace: string, jobUuid: string) => {
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
    const saveWorkspaceToFSxCommands = [
        `while ! test -f /workspace/finished ; do sleep 1; done`,
        `rm -f  /workspace/finished`,
        // We can secure an exclusive lock before writing our file in case there are other readers/writers
        `cd /workspace ; flock -x /persistence/workspace.tar tar -cf /persistence/workspace.tar *`,
    ]

    return k8sapi.createNamespacedPod(namespace, {
        metadata: {
            name: `build-${jobUuid}`,
            namespace: namespace
        },
        spec: {
            restartPolicy: "OnFailure",
            initContainers: [
                {
                    name: "retrieve-code-from-github",
                    imagePullPolicy: "IfNotPresent",
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
                    imagePullPolicy: "IfNotPresent",
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
                    imagePullPolicy: "IfNotPresent",
                    image: "public.ecr.aws/docker/library/centos",
                    workingDir: "/workspace",
                    command: [
                        "/bin/sh",
                        "-c",
                        saveWorkspaceToFSxCommands.join(";")
                    ],
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
                        },
                        {
                            mountPath: "/persistence",
                            name: "fsx-volume",
                            subPath: `workspaces/${jobUuid}`
                        },
                        {
                            mountPath: "/outputs",
                            name: "fsx-volume",
                            subPath: `outputs/${jobUuid}`
                        }
                    ]
                }
            ],
            volumes: [
                {
                    name: "workspace",
                    emptyDir: {
                        sizeLimit: "5Gi",
                        medium: "Memory"
                    }
                },
                {
                    name: "fsx-volume",
                    persistentVolumeClaim: {
                        claimName: `fsx-pvc-${jobUuid}`
                    }
                }
            ]
        }
    })
}

(async () => {

    const kc = new k8s.KubeConfig();
    kc.loadFromDefault({
    });
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    try {
        const namespace = "workspace-to-fsx"
        const uuidsForJobs = jobUuids.slice(0, parsePodCount())
        // First provision our pv, and pvc so we can drop our pods all at once
        for(const jobUuid of uuidsForJobs) {
            await createPv(k8sApi, namespace, jobUuid)
            await createPvc(k8sApi, namespace, jobUuid)
        }
        const pods: Array<Promise<any>> = []
        uuidsForJobs.forEach((jobUuid) => {
            pods.push(createBuildPodFSx(k8sApi, namespace, jobUuid))
        })
        // Submit all the pods at once
        Promise.all(pods).then(() => {})

    } catch (e) {
        console.error(e)
    }
})()