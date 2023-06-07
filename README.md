# Overview

This repository contains code to support this blog {TODO Link}.  You should start by reading the blog to understand the context!

You can reproduce the results discussed in the blog, and experiment with your own configurations to find the right solution for your use-case.

## Deployed Resources

Note, these resources are beyond the free tier!  Recommend reviewing the settings and assuring you understand the costs before deploying.  

When you're experiments are finished, you can destroy the stack easily using the CDK!

To support our benchmarks, this CDK project will create:
- An EKS Cluster
- An EC2 instance worker node (you can optionally choose the type and quantity)
- An FSxL filesystem (you can optionally configure the throughput and size)
- An S3 bucket
- All the required IRSA roles and permissions to function.
- Supporting helm charts:
  - The EBS CSI Driver
  - The FSxL CSI Driver
  - Prometheus Operator
  - Grafana preloaded with a dashboard and pointing to the Prometheus environment

## Environment Setup

An AWS Cloud9 environment will contain all the tools and software to use this repository right away.  Alternately anything with a command line and a text editor should do the trick!

You can follow the getting started guide for Cloud9 [here](https://aws.amazon.com/cloud9/getting-started/)

### CDK

If you're using Cloud9, you should already have the CDK installed (use version 2).

Otherwise, you can follow [these instructions](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html#getting_started_install) to install the CDK (use version 2).

### Modules

After installing the CDK, install the required NPM modules for the project by running:

```bash
npm install
```

### Deployment Account

Configure your AWS CLI Credentials to work against the account you will deploy to.

If you're in an AWS Cloud9 environment this should already be done for you!  If you're not using AWS Cloud9 configure the AWS CLI using [these](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html) instructions.

Be sure to set the region to match the region you wish to deploy to.  eg:

```bash
export AWS_REGION=us-east-1
```

Run a quick test to make sure the credentials are working

```bash
aws sts get-caller-identity 
```

This command should succeed and show the identity you're using with AWS.

### Bootstrap

The CDK requires a place to put assets it builds.  Bootstrap this account to handle this by running:

```bash
cdk bootstrap
```

### Kubectl

If you're not using Cloud9 - you'll need to install the `kubectl` command.  Follow instructions [here](https://kubernetes.io/docs/tasks/tools/#kubectl)

### Configuration (optional)

Edit file `bin/eks-cicd-storage.ts`.  You can edit content in section:

```text
    ec2InstanceType: ec2.InstanceType.of(ec2.InstanceClass.MEMORY6_AMD, ec2.InstanceSize.XLARGE8),
    ec2InstanceCount: 1,
    ec2InstanceStorageGb: 1000,
    fsxStorageSizeGb: 1200,
    fsxThroughputPerTb: 500,
```

The `ec2InstanceType` that is deployed for the cluster can be set using the CDK: [https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.InstanceType.html#example](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.InstanceType.html#example)

The `ec2InstanceCount` configures how many nodes are deployed.

The `ec2InstanceStorageGb` configures the size of the EBS volume attached to the instance(s).

You can control the amount of storage, and the throughput per TB for FSx.  Read through this documentation to understand the ratios and impacts: [https://docs.aws.amazon.com/fsx/latest/LustreGuide/managing-storage-capacity.html](https://docs.aws.amazon.com/fsx/latest/LustreGuide/managing-storage-capacity.html)

The `fsxStorageSizeGb` controls the size of the FSxL filesystem.

The `fsxThroughputPerTb` controls how much FSxL throughput is available per TB.

There are additional configurations around Kubernetes versions, and Helm chart versions that can be configured here too if desired.

### Deploy!

Once you're comfortable that everything looks good, execute a deployment!

```bash
cdk deploy --require-approval never
```

Leave off the `--require-aproval never` if you'd like to be prompted when security groups / IAM roles will be created to allow it to proceed.

Deployment will take a little while since it is creating an EKS cluster, EC2 instance(s), then applying all the base-line manifests and helm charts to be able to run the benchmarks.  Grab a coffee!

### Configure Kubectl

After the CDK App has finished deployment it will print out the command required to configure Kubectl.  Output looks similar to the following:

```
Outputs:
EksCiCdStorage.eksClusterEksClusterConfigCommandDCE878CA = aws eks update-kubeconfig --name EKS-CiCd-Storage --region us-east-2 --role-arn arn:aws:iam::012345678910:role/EKS-CiCd-Storage-acccess-role
```

Run the command shown to configure `kubectl` to access the provisioned cluster.

Verify you have access to the cluster using kubectl by checking for nodes.

```
kubectl get nodes
```

The node count should match the number you specified, or one if you went with defaults.

### Connect to Grafana

We're using an in-cluster Grafana and have imported a dashboard to see the results of our benchmarks.

We can view the Grafana web interface using a port forward and using the credentials created by the Helm chart.

First retrieve the credentials:

```
GRAF_PASS=$(kubectl -n monitoring get secret grafana -o jsonpath="{.data.admin-password}" | base64 --decode)
echo $GRAF_PASS
```

Now configure the port configure the port forward:

```
kubectl port-forward -n monitoring service/grafana 3000:80
```

Open [http://localhost:3000](http://localhost:3000) in your browser.


Then sign in using the `admin` user and the credential output above.

# Benchmarks

For those interested - the code and manifests underpinning each benchmark is in the `benchmarks` folder.

Grafana has a preloaded Dashboard showing you pod execution times for each style of build / test.

It's named 'Pod Run Times' and it's located in the 'examples' folder.  Scroll within the dashboard to see the results of each benchmark.

## Setting the numbers of pods to execute

Each benchmark supports a number argument up to 30.  This is the number of pods to submit in parallel for that benchmark.

If no argument is specified it will create one pod for a baseline.

```bash
export RUN_PODS=5
```

## EBS Backed Build

Execute:

```bash
npm run ebs-backed-build ${RUN_PODS}
```

You can watch the pods get created, and eventually complete using the watch command below.  When it's finished load the Grafana Dashboard and see your results!

```bash
watch -n 5 kubectl -n ebs-backed-workspace get pods
```

## Memory Backed Build

Execute:

```bash
npm run memory-backed-build ${RUN_PODS}
```

You can watch the pods get created, and eventually complete using the watch command below.  When it's finished load the Grafana Dashboard and see your results!

```bash
watch -n 5 kubectl -n memory-backed-workspace get pods
```

## Workspace to S3

Execute:

```bash
npm run direct-to-s3 ${RUN_PODS}
```

You can watch the pods get created, and eventually complete using the watch command below.  When it's finished load the Grafana Dashboard and see your results!

```bash
watch -n 5 kubectl -n workspace-direct-to-s3 get pods
```

## Workspace to FSxL - Notes

While working with FSxL I'm persisting a workspace between executions by using a UUID.  This lets us re-use the same physical volume and workspace data when executing our test phase.

Note that if you're re-running the FSxL benchmarks on a regular basis you will need to delete your completed pods to reclaim that UUID for a new pod.

## Workspace to FSxL - Build

Execute:

```bash
npm run fsx-backed-build ${RUN_PODS}
```

You can watch the pods get created, and eventually complete using the watch command below.  When it's finished load the Grafana Dashboard and see your results!

```bash
watch -n 5 kubectl -n workspace-to-fsx get pods
```

## Workspace to FSxL - Test

Execute:

```bash
npm run fsx-backed-test ${RUN_PODS}
```

These execute in the same workspace, but use a restoration of workspace from FSxL, then execute test cases.  So you can watch those pods complete in the `workspace-to-fsx` namespace as well.

```bash
watch -n 5 kubectl -n workspace-to-fsx get pods
```

## View your test results in your bucket!

In the 'Outputs' section of the CloudFormation template created by the CDK, you'll find the bucket name that the FSxL tests will write their outputs to.

You can view the contents, and download data from that bucket sorted by the 'uuid' used for the workspace.  Example commands preceded by the `$` (use your bucket name!)

```bash
$ export BUCKET="ekscicdstorage-fsxlfilesystemfsxreplicationbucket-j161nywpxr1t"
$ aws s3 ls s3://${BUCKET}/
                           PRE 2ee34c7e-eab4-4689-890e-467c08c78014/
                           PRE 513198c6-1630-44af-9b06-351b7e5f0a9d/
                           PRE 6614d346-baca-4c1b-a932-4d4b0604084e/
                           PRE daa7de23-a70a-4e7b-bcca-50dc3a028b1d/
                           PRE e3669a67-b5de-4b8b-87aa-a3de43aa8380/
$ aws s3 ls s3://${BUCKET}/2ee34c7e-eab4-4689-890e-467c08c78014/
2023-06-06 21:43:29          0 
2023-06-06 21:55:31     400355 test-results.txt
$ aws s3 cp s3://${BUCKET}/2ee34c7e-eab4-4689-890e-467c08c78014/test-results.txt .
download: s3://${BUCKET}/2ee34c7e-eab4-4689-890e-467c08c78014/test-results.txt to ./test-results.txt
$ tail -n 10 test-results.txt 
@aws-accelerator/installer:  solutions-helper.ts       |     100 |      100 |     100 |     100 |                   
@aws-accelerator/installer:  validate.ts               |     100 |      100 |     100 |     100 |                   
@aws-accelerator/installer: ---------------------------|---------|----------|---------|---------|-------------------

 

 >  Lerna (powered by Nx)   Successfully ran target test for 9 projects


Done in 364.52s.
```

# Cleanup

Destroy our stack

```
cdk destroy
```

Note that there will be two buckets that can't be removed by CloudFormation since they are not empty.  Remove them by hand after the 'destroy' operation completes.