const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");

const config = new pulumi.Config();
const publicCidrBlock = config.require("publicCidrBlock");
const vpcCidrBlock = config.require("vpcCidrBlock");
const ebsVolSize = config.require("ebsVolSize");
const ebsVolType = config.require("ebsVolType");

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

    const instance = new aws.ec2.Instance("myEC2Instance", {
        ami: ami_id, // Replace with your custom AMI ID
        instanceType: "t2.micro", // Replace with your desired instance type
        keyName: ec2Keypair,
        vpcSecurityGroupIds: [appSecurityGroup.id], // Attach the Application Security Group
        subnetId: resources.subnets[0], // Choose a public subnet for the EC2 instance
        rootBlockDevice: {
            volumeSize: ebsVolSize,
            volumeType: ebsVolType,
            deleteOnTermination: true,
        },
        disableApiTermination: false,
        tags: {
            Name: "myPulumiEC2Instance",
        },
    });

    exports.resources = resources;
});


