#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsRedisV7Stack } from '../lib/aws_redis_v7-stack';

const app = new cdk.App();
new AwsRedisV7Stack(app, 'AwsRedisV7Stack');
