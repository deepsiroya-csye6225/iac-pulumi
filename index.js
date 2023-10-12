
"use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");

const config = new pulumi.Config();

const numSubnets = config.getNumber("subnets") || 0;

const vpcCidrBlock = config.require("vpcCidrBlock");


const publicCidrBlock = config.require("publicCidrBlock");

// Setup VPC
const vpc = new aws.ec2.Vpc("myVpcPulumi", {
    tags: {
        Name: "myVpcPulumi", 
    },
    cidrBlock: vpcCidrBlock
});

// Setup Internet Gateway
const ig = new aws.ec2.InternetGateway("myIgPulumi", {
    tags: {
        Name: "myIgPulumi", 
    },
    vpcId: vpc.id,
});


// Calculate the subnet CIDR blocks dynamically
const subnetCidrBlocks = [];
for (let i = 0; i < numSubnets; i++) {
    const subnetCidrBlock = pulumi.interpolate`10.0.${i + 1}.0/24`;
    subnetCidrBlocks.push(subnetCidrBlock);
}

// Specify only the available AZs
const availableAZs = config.getObject("availableAZs") || [];

const subnets = subnetCidrBlocks.map((block, index) => 
    new aws.ec2.Subnet(`mySubnet${index + 1}`, {
        vpcId: vpc.id,
        tags: {
            Name: `mySubnet${index + 1}_Pulumi`, 
        },
        cidrBlock: block,
        availabilityZone: availableAZs[index % availableAZs.length], 
        mapPublicIpOnLaunch: index < 3, // First 3 subnets will be public
    })
);

// Setup Route Tables
const publicRt = new aws.ec2.RouteTable("publicRt", {
    vpcId: vpc.id,
    tags: {
        Name: "publicRtPulumi", 
    },
    routes: [{
        cidrBlock: publicCidrBlock,
        gatewayId: ig.id,
    }],
});

const privateRt = new aws.ec2.RouteTable("privateRt", {
    vpcId: vpc.id,
    tags: {
        Name: "privateRtPulumi", 
    },
});

// Associate Route Tables with respective Subnets
subnets.forEach((subnet, index) => 
    new aws.ec2.RouteTableAssociation(`myRtAssoc${index + 1}`, {
        subnetId: subnet.id,
        routeTableId: index < 3 ? publicRt.id : privateRt.id, // First 3 subnets are public
    })
);

// Export VPC & Subnet IDs for future reference
exports.vpcId = vpc.id;
exports.subnetIds = subnets.map(s => s.id);
