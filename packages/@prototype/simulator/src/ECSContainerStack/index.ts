/*********************************************************************************************************************
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.                                               *
 *                                                                                                                   *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy of                                  *
 *  this software and associated documentation files (the "Software"), to deal in                                    *
 *  the Software without restriction, including without limitation the rights to                                     *
 *  use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of                                 *
 *  the Software, and to permit persons to whom the Software is furnished to do so.                                  *
 *                                                                                                                   *
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR                                       *
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS                                 *
 *  FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR                                   *
 *  COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER                                   *
 *  IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN                                          *
 *  CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.                                       *
 *********************************************************************************************************************/
import { Construct } from 'constructs'
import { aws_ecs as ecs, aws_ecr_assets as ecr_assets, aws_s3 as s3, aws_iot as iot, aws_iam as iam, aws_dynamodb as ddb, aws_ec2 as ec2, custom_resources as cr, aws_cognito as cognito, aws_secretsmanager as secrets } from 'aws-cdk-lib'
import { namespaced } from '@aws-play/cdk-core'
import { SimulatorContainer } from './SimulatorContainer'
import { sync as findup } from 'find-up'
import path from 'path'

interface ECSContainerStackProps {
	readonly userPool: cognito.UserPool
	readonly identityPool: cognito.CfnIdentityPool
	readonly userPoolClient: cognito.UserPoolClient
	readonly iotIngestionRule: iot.CfnTopicRule
	readonly iotDriverStatusRule: iot.CfnTopicRule
	readonly iotDestinationStatusRuleName: string
	readonly iotOriginStatusRuleName: string
	readonly iotDriverPolicy: iot.CfnPolicy
	readonly ecsVpc: ec2.IVpc
	readonly simulatorConfig: { [key: string]: string | number, }
	readonly configBucket: s3.IBucket
	readonly configBucketKey: string

	readonly originTable: ddb.Table
	readonly originAreaIndex: string
	readonly originExecutionIdIndex: string
	readonly originUserPassword: string

	readonly destinationTable: ddb.Table
	readonly destinationAreaIndex: string
	readonly destinationExecutionIdIndex: string
	readonly destinationUserPassword: string

	readonly simulatorConfigBucket: s3.IBucket
}

export class ECSContainerStack extends Construct {
	public readonly cluster: ecs.Cluster

	public readonly driverSimulator: SimulatorContainer

	public readonly destinationSimulator: SimulatorContainer

	public readonly originSimulator: SimulatorContainer

	constructor (scope: Construct, id: string, props: ECSContainerStackProps) {
		super(scope, id)

		this.cluster = new ecs.Cluster(this, 'ECSSimulatorCluster', {
			clusterName: namespaced(this, 'simulator'),
			vpc: props.ecsVpc,
			containerInsights: true,
		})

		const getIoTEndpoint = new cr.AwsCustomResource(this, 'IoTEndpoint', {
			onCreate: {
				service: 'Iot',
				action: 'describeEndpoint',
				physicalResourceId: cr.PhysicalResourceId.fromResponse('endpointAddress'),
				parameters: {
					endpointType: 'iot:Data-ATS',
				},
			},
			policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
				resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
			}),
		})

		const iotEndpointAddress = getIoTEndpoint.getResponseField('endpointAddress')

		const simulatorContainerImageAsset = new ecr_assets.DockerImageAsset(this, 'SimulatorImage', {
			directory: path.join(
				findup('packages', { cwd: __dirname, type: 'directory' }) || '../../../../',
				'..',
				'prototype', 'simulator', 'container',
			),
		})

		this.driverSimulator = new SimulatorContainer(this, 'DriverSimulatorContainer', {
			name: 'driver',
			cpu: 256,
			memoryMiB: 512,
			simulatorContainerImageAsset,
			baseUsername: props.simulatorConfig.driverBaseUsername as string,
			iotEndpointAddress,
			...props,
		})

		const destinationPasswordSecret = new secrets.Secret(this, 'DestinationPasswordSecret', {
			secretStringBeta1: secrets.SecretStringValueBeta1.fromUnsafePlaintext(props.destinationUserPassword),
		})

		this.destinationSimulator = new SimulatorContainer(this, 'DestinationSimulatorContainer', {
			name: 'destination',
			cpu: 256,
			memoryMiB: 512,
			simulatorContainerImageAsset,
			baseUsername: props.simulatorConfig.destinationBaseUsername as string,
			iotEndpointAddress,
			...props,
			additionalENVs: {
				DESTINATION_TABLE_NAME: props.destinationTable.tableName,
				DESTINATION_EXECUTIONID_INDEX: props.destinationExecutionIdIndex,
				DESTINATION_AREA_INDEX: props.destinationAreaIndex,
				DESTINATION_PASSWORD_SECRET: destinationPasswordSecret.secretArn,
				DESTINATION_STATUS_UPDATE_RULE_NAME: props.iotDestinationStatusRuleName,
			},
		})
		this.destinationSimulator.taskDefinitionRole.addToPolicy(
			new iam.PolicyStatement({
				actions: [
					'dynamodb:UpdateItem',
					'dynamodb:Query',
				],
				effect: iam.Effect.ALLOW,
				resources: [
					props.destinationTable.tableArn,
					`${props.destinationTable.tableArn}/index/${props.destinationExecutionIdIndex}`,
					`${props.destinationTable.tableArn}/index/${props.destinationAreaIndex}`,
				],
			}),
		)
		this.destinationSimulator.taskDefinitionRole.addToPolicy(
			new iam.PolicyStatement({
				actions: [
					'secretsmanager:GetSecretValue',
				],
				effect: iam.Effect.ALLOW,
				resources: [
					`${destinationPasswordSecret.secretArn}*`,
				],
			}),
		)

		const originPasswordSecret = new secrets.Secret(this, 'OriginPasswordSecret', {
			secretStringBeta1: secrets.SecretStringValueBeta1.fromUnsafePlaintext(props.originUserPassword),
		})

		this.originSimulator = new SimulatorContainer(this, 'OriginSimulatorContainer', {
			name: 'origin',
			cpu: 256,
			memoryMiB: 512,
			simulatorContainerImageAsset,
			baseUsername: props.simulatorConfig.originBaseUsername as string,
			iotEndpointAddress,
			...props,
			additionalENVs: {
				ORIGIN_TABLE_NAME: props.originTable.tableName,
				ORIGIN_EXECUTIONID_INDEX: props.originExecutionIdIndex,
				ORIGIN_AREA_INDEX: props.originAreaIndex,
				ORIGIN_PASSWORD_SECRET: originPasswordSecret.secretArn,
				ORIGIN_STATUS_UPDATE_RULE_NAME: props.iotOriginStatusRuleName,
			},
		})
		this.originSimulator.taskDefinitionRole.addToPolicy(
			new iam.PolicyStatement({
				actions: [
					'dynamodb:UpdateItem',
					'dynamodb:Query',
				],
				effect: iam.Effect.ALLOW,
				resources: [
					props.originTable.tableArn,
					`${props.originTable.tableArn}/index/${props.originExecutionIdIndex}`,
					`${props.originTable.tableArn}/index/${props.originAreaIndex}`,
				],
			}),
		)
		this.originSimulator.taskDefinitionRole.addToPolicy(
			new iam.PolicyStatement({
				actions: [
					'secretsmanager:GetSecretValue',
				],
				effect: iam.Effect.ALLOW,
				resources: [
					`${originPasswordSecret.secretArn}*`,
				],
			}),
		)
	}
}
