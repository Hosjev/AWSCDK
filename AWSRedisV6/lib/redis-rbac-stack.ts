import * as cdk from 'aws-cdk-lib';
import { 
  aws_ec2 as ec2,
  aws_kms as kms, 
  aws_iam as iam, 
  aws_elasticache as elasticache, 
  aws_lambda as lambda,
  aws_secretsmanager as secretsmanager} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import path = require('path');
import { RedisRbacUser } from  "./redis-rbac-secret-manager";

import fs = require('fs');

import { setFlagsFromString } from 'v8';


export class RedisRbacStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------------------------------------------------
    // This constructor will deploy resources required to link ElastiCache Redis, with SecretsManager and IAM
    // -----------------------------------------------------------------------------------------------------------
    // Steps:
    // Step 1) create a VPC into which the ElastiCache replication group will be placed
    // Step 2) create Redis RBAC users
    //    a) one secret in Secrets Manager will be created for each
    // Step 3) create IAM roles and grant them read access to the appropriate secret
    // Step 4) create an ElastiCache Redis replication group
    // Step 5) create test functions

    let producerName = 'producer'
    let elasticacheReplicationGroupName = 'RedisReplicationGroup'

    // ------------------------------------------------------------------------------------
    // Step 1) Create a VPC into which the ElastiCache replication group will be placed
    //     a) only private subnets will be used
    //     b) a Secrets Manager VPC endpoint will be added to allow access to Secrets Manager
    // ------------------------------------------------------------------------------------

    const vpc = new ec2.Vpc(this, "Vpc", {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }
      ]
    });

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSG', {
      vpc: vpc,
      description: 'SecurityGroup into which Lambdas will be deployed',
      allowAllOutbound: false
    });

    const secretsManagerVpcEndpointSecurityGroup = new ec2.SecurityGroup(this, 'SecretsManagerVPCeSG', {
      vpc: vpc,
      description: 'SecurityGroup for the VPC Endpoint Secrets Manager',
      allowAllOutbound: false,
    });

    // where stack connects
    secretsManagerVpcEndpointSecurityGroup.connections.allowFrom(lambdaSecurityGroup, ec2.Port.tcp(443));

    vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      },
      open: false,
      securityGroups: [secretsManagerVpcEndpointSecurityGroup]
    });

    const ecSecurityGroup = new ec2.SecurityGroup(this, 'ElastiCacheSG', {
      vpc: vpc,
      description: 'SecurityGroup associated with the ElastiCache Redis Cluster',
      allowAllOutbound: false,
    });

    // all traffic is proxied thru lambdas
    ecSecurityGroup.connections.allowFrom(lambdaSecurityGroup, ec2.Port.tcp(6379), 'Redis ingress 6379');
    ecSecurityGroup.connections.allowTo(lambdaSecurityGroup, ec2.Port.tcp(6379), 'Redis egress 6379');

    // ------------------------------------------------------------------------------------
    // Step 2) Create IAM roles
    //     a) each IAM role will be assumed by a lambda function
    //     b) each IAM role will be granted read and decrypt permissions to a matching secret
    // ------------------------------------------------------------------------------------
    const producerRole = new iam.Role(this, producerName+'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role to be assumed by producer lambda',
    });
    producerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
    producerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"));


    // ------------------------------------------------------------------------------------
    // Step 3) Create Redis RBAC users
    //     a) access strings will dictate operations that can be performed
    //     b) RedisRbacUser is a class defined in redis-rbac-secret-manager.ts
    //     c) RedisRbacUser is composed of an AWS::ElastiCache::User and a Secret
    // ------------------------------------------------------------------------------------
    const commonKmsKey = new kms.Key(this, 'commonCredentialKey', {
      alias: 'redisRbacUser/common',
      enableKeyRotation: true
    });

    const producerRbacUser = new RedisRbacUser(this, producerName+'RBAC', {
      redisUserName: producerName,
      redisUserId: producerName,
      accessString: 'on ~* -@all +SET',
      kmsKey: commonKmsKey,
      principals: [producerRole]
    });

    // Create RBAC user group
    const mockAppUserGroup = new elasticache.CfnUserGroup(this, 'mockAppUserGroup', {
      engine: 'redis',
      userGroupId: 'mock-app-user-group',
      userIds: ['default', producerRbacUser.getUserId()]
    })
    mockAppUserGroup.node.addDependency(producerRbacUser);

    // ------------------------------------------------------------------------------------
    // Step 4) Create an ElastiCache Redis Replication group and associate the RBAC user group
    //     a) an ElastiCache subnet group will be created
    //     b) the ElastiCache replication group will be associated with the RBAC user group
    // ------------------------------------------------------------------------------------

    let isolatedSubnets: string[] = []

    vpc.isolatedSubnets.forEach(function(value){
      isolatedSubnets.push(value.subnetId)
    });

    const ecSubnetGroup = new elasticache.CfnSubnetGroup(this, 'ElastiCacheSubnetGroup', {
      description: 'Elasticache Subnet Group',
      subnetIds: isolatedSubnets,
      cacheSubnetGroupName: 'RedisSubnetGroup'
    });

    const elastiCacheKmsKey = new kms.Key(this, 'kmsForSecret', {
      alias: 'redisReplicationGroup/'+elasticacheReplicationGroupName,
      enableKeyRotation: true
    });

    // elastiCacheKmsKey.grantEncrypt(producerRole);
    // elastiCacheKmsKey.grantDecrypt(consumerRole);

    const ecClusterReplicationGroup = new elasticache.CfnReplicationGroup(this, elasticacheReplicationGroupName, {
      replicationGroupDescription: 'RedisReplicationGroup-RBAC-Demo',
      atRestEncryptionEnabled: true,
      multiAzEnabled: true,
      cacheNodeType: 'cache.m6g.large',
      cacheSubnetGroupName: ecSubnetGroup.cacheSubnetGroupName,
      engine: "Redis",
      engineVersion: '6.x',
      numNodeGroups: 1,
      kmsKeyId: elastiCacheKmsKey.keyId,
      replicasPerNodeGroup: 1,
      securityGroupIds: [ecSecurityGroup.securityGroupId],
      transitEncryptionEnabled: true,
      userGroupIds: [mockAppUserGroup.userGroupId]
    })

    ecClusterReplicationGroup.node.addDependency(ecSubnetGroup)
    ecClusterReplicationGroup.node.addDependency(mockAppUserGroup)

    // ------------------------------------------------------------------------------------
    // Step 5) Create test functions
    //     a) one producer
    //     b) one consumer
    //     c) one that cannot access Redis
    // ------------------------------------------------------------------------------------
    const redisPyLayer = new lambda.LayerVersion(this, 'redispy_Layer', {
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda/lib/redis_module/redis_py.zip')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_8, lambda.Runtime.PYTHON_3_7, lambda.Runtime.PYTHON_3_6],
      description: 'A layer that contains the redispy module',
      license: 'MIT License'
    });

    // THIS would be mocking the TS in-stack code
    // I'd be executing this Lambda (which calls the Redis support code, to return username/passwd)
    // need: IAM arn, vpc arn, sec grp arn, RbacUser arn, ReplGrp arn
    const producerLambda = new lambda.Function(this, producerName+'Fn', {
      runtime: lambda.Runtime.PYTHON_3_7,
      handler: 'redis_connect.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda/mock_app.zip')),
      layers: [redisPyLayer],
      role: producerRole, // IAM user
      vpc: vpc,
      vpcSubnets: {subnetType: ec2.SubnetType.PRIVATE_ISOLATED},
      securityGroups: [lambdaSecurityGroup],
      environment: {
        redis_endpoint: ecClusterReplicationGroup.attrPrimaryEndPointAddress,
        redis_port: ecClusterReplicationGroup.attrPrimaryEndPointPort,
        secret_arn: producerRbacUser.getSecret().secretArn,
      }
    });

    producerLambda.node.addDependency(redisPyLayer);
    producerLambda.node.addDependency(ecClusterReplicationGroup);
    producerLambda.node.addDependency(vpc);
    producerLambda.node.addDependency(producerRole);

  }

}
