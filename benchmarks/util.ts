import * as k8s from "@kubernetes/client-node";

export const jobUuids = [
    "daa7de23-a70a-4e7b-bcca-50dc3a028b1d",
    "513198c6-1630-44af-9b06-351b7e5f0a9d",
    "e3669a67-b5de-4b8b-87aa-a3de43aa8380",
    "6614d346-baca-4c1b-a932-4d4b0604084e",
    "2ee34c7e-eab4-4689-890e-467c08c78014",
    "a3d2e0d5-62a9-4474-a107-33b393d10854",
    "a1ddc0e7-ac98-40f5-8d65-2c7f7471aa48",
    "dc3bbb19-8966-4dda-9b8d-efcd9876e0bd",
    "d29444f9-19b6-44b0-b94a-981a69440c04",
    "062cc77c-fe65-465f-b869-04388d0b46b6",
    "5627c5a1-7d07-4593-909d-a2c3e1cd0138",
    "5f2feca7-de00-490e-84bb-0105d3f64080",
    "c4e1f167-cc61-47bf-90fb-3472ceae5b11",
    "7460e77a-939b-4aa4-94bf-eb2920f30bb5",
    "bc07343c-229b-4244-9754-917435e3d2d3",
    "e561a021-9a19-4e32-8325-43702b9f3697",
    "2430e0df-ef51-4bd2-b252-1c5034c10fea",
    "5f83e2e0-a9fc-4d51-9a6c-66de52b714a5",
    "06f4c95e-90fa-4505-a5ff-6670c84c955d",
    "e5cf03f9-37d3-42bb-87fa-2ee1dfdb38ca",
    "007c6680-a3d0-4b57-90a6-9e746aa589f3",
    "9047c787-d108-4bf5-9945-beec453b81bb",
    "eeb556cc-6996-4979-b059-846ebb75c12b",
    "de0ab285-8067-4f37-b3d2-0090cf8b68e6",
    "ee46f94e-ca4e-4005-a616-364de6ed8fa8",
    "80fc0a39-04e0-43d2-924b-36f2d736a280",
    "2308f9d7-167d-4e05-8d99-1ed5274694da",
    "baab90d4-79f4-4c28-b6b0-69b3f43dfad3",
    "e8d78afb-7793-4d39-9325-cb20ccedfab1",
    "0910dd33-d824-4b68-bc6a-0b94f723d134",
]

interface fsxConfigData {
    filesystemDnsName: string
    filesystemId: string
    filesystemMountName: string
    replicationBucket: string
}

export const parsePodCount = (): number => {
    let podCount = 1
    if(process.argv.length > 2) {
        const podArgument = parseInt(process.argv[2])
        if(!isNaN(podArgument)) {
            podCount = podArgument
        }
    }
    if(podCount > 30) {
        throw new Error("Maximum 30 pods supported.  Edit the utils.ts to adjust if needed.")
    }
    return podCount
}

export const readFsxConfigmap = async (k8sApi:  k8s.CoreV1Api, namespace: string): Promise<fsxConfigData> => {
    let fsxData: fsxConfigData = {
        filesystemDnsName: "",
        filesystemId: "",
        filesystemMountName: "",
        replicationBucket: ""
    }
    const fsxConfigMap = await k8sApi.readNamespacedConfigMap("fsx-deployment-info", namespace)
    if(fsxConfigMap.body.data) {
        const data = fsxConfigMap.body.data
        fsxData.filesystemDnsName = data.filesystemDnsName
        fsxData.filesystemId = data.filesystemId
        fsxData.filesystemMountName = data.filesystemMountName
        fsxData.replicationBucket = data.replicationBucket
    }
    return fsxData
}

export const createPv = async (k8sApi:  k8s.CoreV1Api, namespace: string, jobUuid: string): Promise<void> => {
    const fsxParameters = await readFsxConfigmap(k8sApi, namespace)
    let exists: boolean = false
    try {
        await k8sApi.readPersistentVolume(`fsx-pv-${jobUuid}`)
        exists = true
    } catch(e) {
        // No need to raise or print, we will create the PV
    }
    if(!exists) {
        await k8sApi.createPersistentVolume({
            metadata: {
                name: `fsx-pv-${jobUuid}`,
                annotations: {
                    "pv.kubernetes.io/provisioned-by": "fsx.csi.aws.com"
                }
            },
            spec: {
                accessModes: ["ReadWriteMany"],
                csi: {
                    driver: "fsx.csi.aws.com",
                    volumeAttributes: {
                        dnsname: fsxParameters.filesystemDnsName,
                        mountname: fsxParameters.filesystemMountName
                    },
                    volumeHandle: fsxParameters.filesystemId
                },
                capacity: {
                    storage: "1200Gi"
                },
                mountOptions: ["flock"],
                persistentVolumeReclaimPolicy: "Retain",
                volumeMode: "Filesystem"
            }
        })
    }
}

export const createPvc = async (k8sApi: k8s.CoreV1Api, namespace: string, jobUuid: string): Promise<void> => {
    let exists: boolean = false
    try {
         await k8sApi.readNamespacedPersistentVolumeClaim(`fsx-pvc-${jobUuid}`, namespace)
        exists = true
    } catch(e) {
        // No need to raise or print, we will create the PV
    }
    if(!exists) {
        await k8sApi.createNamespacedPersistentVolumeClaim(namespace, {
            metadata: {
                name: `fsx-pvc-${jobUuid}`
            },
            spec: {
                accessModes: [ "ReadWriteMany" ],
                resources: {
                    requests: {
                        storage: "1200Gi"
                    }
                },
                storageClassName: "",
                volumeMode: "Filesystem",
                volumeName: `fsx-pv-${jobUuid}`
            }
        })
    }
}