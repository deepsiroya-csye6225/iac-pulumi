const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const route53 = require("@pulumi/aws/route53");
const iam = require("@pulumi/aws/iam");
const mysql = require("@pulumi/aws/rds");

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
const hostedZoneId = config.require("hostedZoneId");

const ec2Keypair = config.require("ec2Keypair");

const ami_id = config.require("ami_id");

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

    // Application Security Group
    const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for web applications",
        tags: {
            Name: "appSG",
        },
        egress: [
        { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
        ],
        ingress: [
        {
            protocol: "tcp",
            fromPort: 22,
            toPort: 22,
            cidrBlocks: ["0.0.0.0/0"],
        },
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"],
        },
        {
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrBlocks: ["0.0.0.0/0"],
        },
        {
            protocol: "tcp",
            fromPort: 3000, 
            toPort: 3000,
            cidrBlocks: ["0.0.0.0/0"],
        },
        ],
    });


    // Database Security Group
    const dbSecurityGroup = new aws.ec2.SecurityGroup("dbSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for RDS instances",
        tags: {
            Name: "dbSG",
        },
        ingress: [
            {
                protocol: "tcp",
                fromPort: 3306, 
                toPort: 3306, 
                securityGroups: [appSecurityGroup.id], 
            },
        ],
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

    const rdsSubnetGroup = new aws.rds.SubnetGroup("my-rds-subnet-group", {
        subnetIds: privateSubnets,
        tags: {
            Name: "myRDSDBSubnetGroup",
        },
    });
    

    // Create an RDS Instance
    const rdsInstance = new aws.rds.Instance("my-rds-instance", {
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

    // EC2 User Data
    const userData = pulumi.all([rdsInstance.endpoint, rdsInstance.dbName, rdsInstance.username, rdsInstance.password]).apply(([endpoint, dbName, username, password]) => {
        const [hostname] = endpoint.split(":");
        return `#!/bin/bash
echo "DB_HOSTNAME=${hostname}" >> /etc/environment
echo "DB_USER=${username}" >> /etc/environment
echo "DB_PASSWORD=${password}" >> /etc/environment
echo "DB_NAME=${dbName}" >> /etc/environment
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

    const instance = new aws.ec2.Instance("myEC2Instance", {
        ami: ami_id, 
        instanceType: "t2.micro", 
        keyName: ec2Keypair,
        vpcSecurityGroupIds: [appSecurityGroup.id], 
        subnetId: resources.subnets[0], 
        userData: userData,
        iamInstanceProfile: cloudWatchInstanceProfile.name,
        rootBlockDevice: {
            volumeSize: ebsVolSize,
            volumeType: ebsVolType,
        },
        disableApiTermination: false,
        tags: {
            Name: "myPulumiEC2Instance",
        },
    });
    
    const aRecord = new route53.Record("webappARecord", {
        name: domain_name, 
        type: "A",
        zoneId: hostedZoneId,
        records: [instance.publicIp], 
        ttl: 300,
    });

    exports.resources = resources;
});

