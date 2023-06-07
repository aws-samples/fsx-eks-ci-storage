import * as k8s from "@kubernetes/client-node"
const { v4: uuidv4 } = require('uuid');
import {parsePodCount} from "./util";

const createBuildPodEbs = async (k8sapi: k8s.CoreV1Api, namespace: string) => {
    const cloneAlzCommands = [
        "cd /workspace/",
        "git clone https://github.com/awslabs/landing-zone-accelerator-on-aws.git",
    ]
    const buildAlzCommands = [
        `cd /workspace/landing-zone-accelerator-on-aws/source`,
        `yarn config set cache-folder /workspace/.yarncache`,
        `yarn install`,
        `yarn build`,
    ];

    return k8sapi.createNamespacedPod(namespace, {
        metadata: {
            name: `build-${namespace}-${uuidv4()}`,
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
                            memory: "1024Mi",
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
            ],
            volumes: [{
                name: "workspace",
                emptyDir: {
                    sizeLimit: "5Gi",
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

    const createJobs = parsePodCount()

    try {
        const ebsNamespace = "ebs-backed-workspace"

        const pods: Array<Promise<any>> = []
        for(let x = 0 ; x < createJobs; x++) {
            pods.push(createBuildPodEbs(k8sApi, ebsNamespace))
        }
        // Submit all the pods at once
        Promise.all(pods).then(() => {})

    } catch (e) {
        console.error(e)
    }
})()