const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const route53 = require("@pulumi/aws/route53");
const iam = require("@pulumi/aws/iam");
const mysql = require("@pulumi/aws/rds");
const gcp = require("@pulumi/gcp");

const config = new pulumi.Config();
const vpcCidrBlock = config.require("vpcCidrBlock");
const ebsVolSize = config.require("ebsVolSize");
const ebsVolType = config.require("ebsVolType");
const engine = config.require("engine");
const dbname = config.require("dbname");
const identifier = config.require("identifier");
const username = config.require("username");
const instanceClass = config.require("instanceClass");
const password = config.require("password");
const domain_name = config.require("domain_name");
const cert_domain_name = config.require("cert_domain_name");
const hostedZoneId = config.require("hostedZoneId");
const gcpConfig = new pulumi.Config("gcp");
const projectId = gcpConfig.require("project");
const bucketName = config.require("bucketName");
const certificate_arn = config.require("certificate_arn");


const ec2Keypair = config.require("ec2Keypair");

const ami_id = config.require("ami_id");

const mailgunApiKey = config.requireSecret("mailgunApiKey");
const mailgunDomain = config.require("mailgunDomain");

aws.getAvailabilityZones().then(availableZones => {
    const numberOfAZs = availableZones.names.length;
    
    // Calculate the number of subnets based on the number of AZs (1 public and 1 private per AZ).
    const numSubnets = numberOfAZs * 2;
    
    const calculateSubnets = (vpcCidr, subnetsCount) => {
        const [bIp, subSize] = vpcCidr.split('/');
        const subBits = Math.ceil(Math.log2(subnetsCount));
        const newSubSize = parseInt(subSize) + subBits;
        
        if (newSubSize > 30) throw new Error("Subnet size small");
        
        const ipParts = bIp.split('.').map(Number);
        const subnets = Array.from({ length: subnetsCount }, (_, i) => {
            const subIp = [ ipParts[0], ipParts[1], i << (8 - subBits), 0 ].join('.');
            return `${subIp}/${newSubSize}`;
        });

        return subnets;
    };
    
    const vpc = new aws.ec2.Vpc("myVpcPulumi", {
        cidrBlock: vpcCidrBlock,
        enableDnsSupport: true,
        enableDnsHostnames: true,
        tags: {
            Name: "myVpcPulumi",
        },
    });

    const ig = new aws.ec2.InternetGateway("myIgPulumi", {
        vpcId: vpc.id,
        tags: {
            Name: "myIgPulumi",
        },
    });

    const publicRt = new aws.ec2.RouteTable("publicRt", {
        vpcId: vpc.id,
        tags: {
            Name: "publicRt",
        },
        routes: [{
            cidrBlock: "0.0.0.0/0",
            gatewayId: ig.id,
        }],
    });

    const privateRt = new aws.ec2.RouteTable("privateRt", {
        vpcId: vpc.id,
        tags: {
            Name: "privateRt",
        },
    });

    const subnets = calculateSubnets(vpcCidrBlock, numSubnets);

    const resources = {
        vpcId: vpc.id,
        internetGatewayId: ig.id,
        subnets: [],
        routeTables: [publicRt.id, privateRt.id],
    };

    for (let i = 0; i < numberOfAZs; i++) {
        const az = availableZones.names[i];
        
        // Create one public and one private subnet for each AZ.
        const publicSubnetCidrBlock = subnets[i * 2];
        const privateSubnetCidrBlock = subnets[i * 2 + 1];
        
        const publicSubnet = new aws.ec2.Subnet(`publicSubnet${i}_Pulumi`, {
            vpcId: vpc.id,
            cidrBlock: publicSubnetCidrBlock,
            availabilityZone: az,
            mapPublicIpOnLaunch: true,
            tags: {
                Name: `publicSubnet${i}_Pulumi`,
            },
        });

        const privateSubnet = new aws.ec2.Subnet(`privateSubnet${i}_Pulumi`, {
            vpcId: vpc.id,
            cidrBlock: privateSubnetCidrBlock,
            availabilityZone: az,
            mapPublicIpOnLaunch: false,
            tags: {
                Name: `privateSubnet${i}_Pulumi`,
            },
        });

        new aws.ec2.RouteTableAssociation(`publicRtAssociation${i}`, {
            subnetId: publicSubnet.id,
            routeTableId: publicRt.id,
        });

        new aws.ec2.RouteTableAssociation(`privateRtAssociation${i}`, {
            subnetId: privateSubnet.id,
            routeTableId: privateRt.id,
        });

        resources.subnets.push(publicSubnet.id, privateSubnet.id);
    }

    const lbSecurityGroup = new aws.ec2.SecurityGroup("lbSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for the load balancer",
        egress: [
            { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"], },
        ],
        ingress: [
            { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
            { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
        ],
        tags: {
            Name: "lbSG",
        },
    });

    const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for application servers",
        egress: [
            { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"], },
        ],
        ingress: [
            { protocol: "tcp", fromPort: 443, toPort: 443, securityGroups: [lbSecurityGroup.id] },
            { protocol: "tcp", fromPort: 3000, toPort: 3000, securityGroups: [lbSecurityGroup.id] },
        ],
        tags: {
            Name: "appSG",
        },
    });


    // Database Security Group
    const dbSecurityGroup = new aws.ec2.SecurityGroup("dbSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for RDS instances",
        ingress: [
            {
                protocol: "tcp",
                fromPort: 3306, 
                toPort: 3306, 
                securityGroups: [appSecurityGroup.id], 
            },
        ],
        tags: {
            Name: "dbSG",
        },
    });

// RDS Parameter Group
    const rdsParameterGroup = new mysql.ParameterGroup("rdsParameterGroup", {
        family: "mariadb10.6", 
        description: "Parameter group for RDS instances",
        parameters: [
            {
                name: "character_set_client", 
                value: "utf8",
            },
        ],
        name: "my-rds-parameter-group",
    });

    const privateSubnets = resources.subnets.filter((_, index) => index % 2 !== 0);
    const publicSubnets = resources.subnets.filter((_, index) => index % 2 === 0);

    const rdsSubnetGroup = new aws.rds.SubnetGroup("my-rds-subnet-group", {
        subnetIds: privateSubnets,
        tags: {
            Name: "myRDSDBSubnetGroup",
        },
    });
    

    // Create an RDS Instance
    const rdsInstance = new aws.rds.Instance("webappRDS", {
        allocatedStorage: 10,
        storageType: ebsVolType, 
        dbName: dbname,
        engine: engine,
        identifier: identifier,
        instanceClass: instanceClass, 
        username: username,
        password: password,
        parameterGroupName: rdsParameterGroup.name,
        vpcSecurityGroupIds: [dbSecurityGroup.id],
        dbSubnetGroupName: rdsSubnetGroup.name, 
        publiclyAccessible: false,
        multiAz: false,
        skipFinalSnapshot: true,
        tags: {
            Name: "myPulumiRDSInstance",
        },
    });


    const cloudWatchAgentServerPolicyDoc = pulumi.output(iam.getPolicyDocument({
        statements: [{
            actions: ["cloudwatch:PutMetricData",
                "cloudwatch:GetMetricStatistics",
                "cloudwatch:ListMetrics",
                "ec2:DescribeTags",
                "logs:PutLogEvents",
                "logs:DescribeLogStreams",
                "logs:DescribeLogGroups",
                "logs:CreateLogStream",
                "logs:CreateLogGroup"],
            resources: ["*"],
        }],
    }));

    const cloudWatchRole = new iam.Role("cloudWatchRole", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "ec2.amazonaws.com",
                },
            }],
        }),
        path: "/",
    });

    const cloudWatchRolePolicy = new iam.RolePolicy("cloudWatchRolePolicy", {
        role: cloudWatchRole.id,
        policy: cloudWatchAgentServerPolicyDoc.json,
    });

    const cloudWatchInstanceProfile = new iam.InstanceProfile("cloudWatchInstanceProfile", {
        role: cloudWatchRole.name,
    });

    const snsTopic = new aws.sns.Topic("snsTopic");

    const snsPublishPolicy = new aws.iam.Policy("snsPublishPolicy", {
        description: "Policy to allow publishing to the SNS topic",
        policy: {
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: "sns:Publish",
                    Resource: snsTopic.arn,
                },
            ],
        },
    });
    
    const snsPublishPolicyAttachment = new aws.iam.PolicyAttachment("snsPublishPolicyAttachment", {
        policyArn: snsPublishPolicy.arn,
        roles: [cloudWatchRole.name],
    });

    const bucket = new gcp.storage.Bucket("submissionBucket", {
        name: bucketName,
        location: "US",
        forceDestroy: true,
    });

    const serviceAccount = new gcp.serviceaccount.Account("myServiceAccount", {
        accountId: "my-app-service-acc",
        displayName: "My Service Account",
    });

    const iamBinding = new gcp.projects.IAMBinding("serviceAccountStorageAdmin", {
        project: projectId,
        members: [pulumi.interpolate`serviceAccount:${serviceAccount.email}`],
        role: "roles/storage.objectAdmin", 
    });
    

    const serviceAccountKeys = new gcp.serviceaccount.Key("myServiceAccountKeys", {
        serviceAccountId: serviceAccount.email,
    });

    // DynamoDB table creation
    const dynamoDBTable = new aws.dynamodb.Table("dynamoDBTable", {
        name: "csye6225-email",
        attributes: [
            { name: "email", type: "S" }, 
        ],
        hashKey: "email",
        billingMode: "PAY_PER_REQUEST",
    });

    const lambdaRole = new aws.iam.Role("lambdaRole", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "lambda.amazonaws.com",
                },
            }],
        }),
    });

    const lambdaPolicy = new aws.iam.Policy("lambdaPolicy", {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: [
                    "sns:Publish",
                    "sns:Subscribe",
                    "dynamodb:*",
                    "s3:*",
                ],
                Effect: "Allow",
                Resource: "*",
            }],
        }),
    });

    const lambdaPolicyAttachment = new aws.iam.RolePolicyAttachment("lambdaPolicyAttachment", {
        role: lambdaRole.name,
        policyArn: lambdaPolicy.arn,
    });

    const lambdaFunction = new aws.lambda.Function("myLambdaFunction", {
        runtime: aws.lambda.Runtime.NodeJS16dX,
        role: lambdaRole.arn,
        handler: "index.handler",
        code: new pulumi.asset.AssetArchive({
            ".": new pulumi.asset.FileArchive("D:/serverless.zip") 
        }),
        timeout: 30,
        environment: {
            variables: {
                GOOGLE_CLOUD_BUCKET: bucket.name,
                MAILGUN_API_KEY: mailgunApiKey,
                MAILGUN_DOMAIN: mailgunDomain,
                DYNAMODB_TABLE_NAME: dynamoDBTable.name,
                GCP_SERVICE_ACCOUNT_KEY: serviceAccountKeys.privateKey.apply(key => key),
            },
        },
    });

    const lambdaPermission = new aws.lambda.Permission("snsLambdaPermission", {
        action: "lambda:InvokeFunction",
        function: lambdaFunction.arn,
        principal: "sns.amazonaws.com",
        sourceArn: snsTopic.arn,
    });
    
    // Subscribe Lambda function to SNS topic
    const snsLambdaSubscription = new aws.sns.TopicSubscription("sns-lambda-subscription", {
        topic: snsTopic.arn,
        protocol: "lambda",
        endpoint: lambdaFunction.arn,
    });

    // EC2 User Data
    const userData = pulumi.all([rdsInstance.endpoint, rdsInstance.dbName, rdsInstance.username, rdsInstance.password, snsTopic.arn]).apply(([endpoint, dbName, username, password, snsTopicArn]) => {
        const [hostname] = endpoint.split(":");
        return `#!/bin/bash
echo "DB_HOSTNAME=${hostname}" >> /etc/environment
echo "DB_USER=${username}" >> /etc/environment
echo "DB_PASSWORD=${password}" >> /etc/environment
echo "DB_NAME=${dbName}" >> /etc/environment
echo "SNS_TOPIC_ARN=${snsTopicArn}" >> /etc/environment
sudo systemctl daemon-reload
sudo systemctl start node-app
sudo systemctl enable node-app
sudo systemctl restart node-app
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent.json -s
sudo systemctl start amazon-cloudwatch-agent
sudo systemctl enable amazon-cloudwatch-agent
sudo systemctl restart amazon-cloudwatch-agent
`;
});

const encodedUserData = userData.apply(data => Buffer.from(data).toString('base64'));

const launchTemplate = new aws.ec2.LaunchTemplate("asg_launch_temp", {
    imageId: ami_id,
    instanceType: "t2.micro",
    keyName: ec2Keypair,
    userData: encodedUserData,
    iamInstanceProfile: { name: cloudWatchInstanceProfile.name, },
    networkInterfaces: [{
        associatePublicIpAddress: true,
        deleteOnTermination: true,
        deviceIndex: 0,
        securityGroups: [appSecurityGroup.id],
    }],
});


const targetGrp = new aws.lb.TargetGroup("webappTG", {
    port: "3000",
    protocol: "HTTP",
    vpcId: vpc.id,
    targetType: "instance",
    healthCheck: {
        enabled: true,
        interval: 30,
        path: "/healthz/",
        port: "3000",
        protocol: "HTTP",
        healthyThreshold: 2,
        unhealthyThreshold: 2,
        timeout: 5,
    },
});

const webappASG = new aws.autoscaling.Group("webappASG", {
    launchTemplate: {
        id: launchTemplate.id,
        version: "$Latest",
    },
    minSize: 1,
    maxSize: 3,
    desiredCapacity: 1,
    vpcZoneIdentifiers: publicSubnets,
    cooldown: 60,
    targetGroupArns: [targetGrp.arn],
    tags: [
        { key: "Name", value: "AutoScalingGroup", propagateAtLaunch: true },
    ],
});

const scaleUpPolicy = new aws.autoscaling.Policy("scaleUpPolicy", {
    autoscalingGroupName: webappASG,
    scalingAdjustment: 1,
    metricAggregationType: "Average",
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
});

const scaleDownPolicy = new aws.autoscaling.Policy("scaleDownPolicy", {
    autoscalingGroupName: webappASG,
    scalingAdjustment: -1,
    metricAggregationType: "Average",
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
});

const scaleUpAlarm = new aws.cloudwatch.MetricAlarm("scaleUpAlarm", {
    metricName: "CPUUtilization",
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 1,
    namespace: "AWS/EC2",
    period: 60,
    dimensions: {
        AutoScalingGroupName: webappASG.name,
    },
    alarmActions: [scaleUpPolicy.arn],
    threshold: 5,
    statistic: "Average",
});

const scaleDownAlarm = new aws.cloudwatch.MetricAlarm("scaleDownAlarm", {
    metricName: "CPUUtilization",
    comparisonOperator: "LessThanThreshold",
    evaluationPeriods: 1,
    namespace: "AWS/EC2",
    period: 60,
    dimensions: {
        AutoScalingGroupName: webappASG.name,
    },
    alarmActions: [scaleDownPolicy.arn],
    threshold: 5,
    statistic: "Average",
});

const alb  = new aws.lb.LoadBalancer("webappLB", {
    internal: false,
    loadBalancerType: "application",
    securityGroups: [lbSecurityGroup.id],
    subnets: publicSubnets,
});

const listener = new aws.lb.Listener("webappListener", {
    loadBalancerArn: alb.arn,
    port: 443,
    protocol: "HTTPS",
    defaultActions: [{
        type: "forward",
        targetGroupArn: targetGrp.arn,
    }],
    sslPolicy: "ELBSecurityPolicy-2016-08",
    certificateArn: certificate_arn,
});

const aRecord = new route53.Record("aRecord", {
    type: "A",
    name: domain_name,
    zoneId: hostedZoneId,
    aliases: [{
        name: alb.dnsName,
        zoneId: alb.zoneId,
        evaluateTargetHealth: true,
    }],
});

    exports.resources = resources;
});
