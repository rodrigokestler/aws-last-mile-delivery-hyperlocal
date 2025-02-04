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
import { aws_events as events, aws_events_targets as events_targets, aws_dynamodb as ddb, aws_lambda as lambda, aws_stepfunctions as stepfunctions, aws_apigateway as apigw, aws_ec2 as ec2 } from 'aws-cdk-lib'
import { Networking } from '@prototype/networking'
import { SERVICE_NAME } from '@prototype/common'
import { MemoryDBCluster } from '@prototype/live-data-cache'
import { OrderManagerHandlerLambda } from './OrderManagerHandler'
import { namespaced } from '@aws-play/cdk-core'
import { OrderManagerStepFunction } from './OrderManagerStepFunction'
import { OrderManagerHelperLambda } from './OrderManagerHelper'
import { ProviderRuleEngineLambda } from './ProviderRuleEngine'

export interface OrderManagerStackProps {
	readonly eventBus: events.EventBus
	readonly demographicAreaProviderEngineSettings: ddb.ITable
	readonly orderTable: ddb.ITable
	readonly providersConfig: { [key: string]: any, }
	readonly providerApiUrls: {[key: string]: apigw.RestApi, }
	readonly privateVpc: ec2.IVpc
	readonly vpcNetworking: Networking
	readonly memoryDBCluster: MemoryDBCluster
	readonly lambdaLayers: { [key: string]: lambda.ILayerVersion, }
	readonly orderManagerSettings: { [key: string]: string | number | boolean, }
}

export class OrderManagerStack extends Construct {
	public readonly orderManagerHandler: lambda.Function

	public readonly orderManagerHelper: lambda.Function

	public readonly orderManagerStepFunction: stepfunctions.StateMachine

	constructor (scope: Construct, id: string, props: OrderManagerStackProps) {
		super(scope, id)

		const {
			eventBus,
			orderTable,
			providersConfig,
			providerApiUrls,
			privateVpc,
			vpcNetworking,
			memoryDBCluster,
			lambdaLayers,
			orderManagerSettings,
			demographicAreaProviderEngineSettings,
		} = props

		this.orderManagerHelper = new OrderManagerHelperLambda(this, 'OrderManagerHelper', {
			dependencies: {
				orderTable,
				eventBus,
				privateVpc,
				vpcNetworking,
				memoryDBCluster,
				lambdaLayers,
			},
		})
		const providerRuleEngine = new ProviderRuleEngineLambda(this, 'ProviderRuleEngine', {
			dependencies: {
				providersConfig,
				providerApiUrls,
				demographicAreaProviderEngineSettings,
			},
		})

		const orderManager = new OrderManagerStepFunction(this, 'OrderManagerStepFunction', {
			orderManagerHelper: this.orderManagerHelper,
			providerRuleEngine,
			orderManagerSettings,
		})

		this.orderManagerStepFunction = orderManager.stepFunction

		this.orderManagerHandler = new OrderManagerHandlerLambda(this, 'OrderManagerHandler', {
			dependencies: {
				orderTable,
				privateVpc,
				vpcNetworking,
				memoryDBCluster,
				lambdaLayers,
				orderOrchestrator: this.orderManagerStepFunction,
			},
		})

		new events.Rule(this, 'OrdersEventConsumer', {
			ruleName: namespaced(this, 'orders-to-order-manager'),
			description: 'Rule used by order manager to consume new incoming orders',
			eventBus,
			enabled: true,
			targets: [new events_targets.LambdaFunction(this.orderManagerHandler)],
			eventPattern: {
				source: [SERVICE_NAME.ORDER_SERVICE],
				detailType: ['NEW_ORDER'],
			},
		})

		new events.Rule(this, 'OriginEventConsumer', {
			ruleName: namespaced(this, 'origin-to-order-manager'),
			description: 'Rule used by order manager to consume origin ack events',
			eventBus,
			enabled: true,
			targets: [new events_targets.LambdaFunction(this.orderManagerHandler)],
			eventPattern: {
				source: [SERVICE_NAME.ORIGIN_SERVICE],
				detailType: ['ORIGIN_ORDER_ACK'],
			},
		})

		new events.Rule(this, 'ProviderEventConsumer', {
			ruleName: namespaced(this, 'provider-to-order-manager'),
			description: 'Rule used by order manager to consume provider update events',
			eventBus,
			enabled: true,
			targets: [new events_targets.LambdaFunction(this.orderManagerHandler)],
			eventPattern: {
				source: [
					SERVICE_NAME.EXAMPLE_POLLING_PROVIDER_SERVICE,
					SERVICE_NAME.EXAMPLE_WEBHOOK_PROVIDER_SERVICE,
					SERVICE_NAME.INSTANT_DELIVERY_PROVIDER_SERVICE,
					SERVICE_NAME.SAME_DAY_DELIVERY_PROVIDER_SERVICE,
				],
				detailType: ['ORDER_UPDATE'],
			},
		})
	}
}
