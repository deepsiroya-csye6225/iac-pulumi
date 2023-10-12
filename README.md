# AWS Infrastructure Setup with Pulumi

This project uses Pulumi to set up AWS networking resources, including a Virtual Private Cloud (VPC), subnets, and route tables. It also configures an Internet Gateway for internet connectivity. 

## Table of Contents

- [AWS Infrastructure Setup with Pulumi](#aws-infrastructure-setup-with-pulumi)
  - [Table of Contents](#table-of-contents)
  - [Project Overview](#project-overview)
  - [Project Structure](#project-structure)
  - [Pulumi Configuration](#pulumi-configuration)
  - [Usage](#usage)

## Project Overview

The primary goal of this project is to create an AWS infrastructure setup for networking resources in your AWS account. This includes a VPC, subnets, route tables, and an Internet Gateway. The setup is defined using Pulumi, an Infrastructure as Code (IaC) tool.

## Project Structure

The project includes the following key files:

- `index.js`: The Pulumi code for creating the AWS infrastructure, including VPC, subnets, Internet Gateway, and route tables.
- `Pulumi.dev.yaml`: Configuration file specifying AWS region, credentials, available availability zones, and CIDR blocks.

## Pulumi Configuration

The `Pulumi.dev.yaml` file contains configuration settings for the Pulumi stack:

- `aws:region`: The AWS region in which the infrastructure will be created (e.g., `us-east-1`).

- `iac-pulumi:myconfigkey` and `iac-pulumi:mysecretconfigkey`: AWS credentials for accessing the AWS account. Please ensure the security of these credentials.

- `iac-pulumi:availableAZs`: A list of available AWS availability zones. These zones will be used to distribute subnets.

- `iac-pulumi:vpcCidr`: The CIDR block for the Virtual Private Cloud (VPC) to be created.

- `subnets`: The number of subnets to create within the VPC.

- `vpcCidrBlock`: The CIDR block for the VPC.

- `publicCidrBlock`: The CIDR block for the public route.

## Usage

1. Install Pulumi and configure it on your local machine.

2. Ensure that you have the necessary AWS credentials with appropriate permissions.

3. Clone this repository and navigate to the project directory.

4. Review and modify the `Pulumi.dev.yaml` file to match your desired configuration.

5. Run the Pulumi deployment using the following commands:

   ```bash
   pulumi stack init <your-stack-name>
   pulumi up

Replace <your-stack-name> with an appropriate name for your Pulumi stack.

Pulumi will create the specified AWS infrastructure based on the provided configuration.

6. When you're done, you can tear down the infrastructure using:
pulumi destroy