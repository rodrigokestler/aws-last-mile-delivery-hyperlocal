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
import * as cdk from '@aws-cdk/core'
import * as iam from '@aws-cdk/aws-iam'
import * as ddb from '@aws-cdk/aws-dynamodb'
import * as lambda from '@aws-cdk/aws-lambda'
import * as step from '@aws-cdk/aws-stepfunctions'
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks'
import * as cognito from '@aws-cdk/aws-cognito'
import * as iot from '@aws-cdk/aws-iot'
import { DeclaredLambdaFunction } from '@aws-play/cdk-lambda'
import { namespaced } from '@aws-play/cdk-core'
import { updateDDBTablePolicyStatement, readDDBTablePolicyStatement, deleteFromDDBTablePolicyStatement } from '@prototype/lambda-common'
import { DEMOGRAPHIC_AREA } from '@prototype/common'

export interface RestaurantGeneratorStepFunctionProps {
	readonly restaurantTable: ddb.ITable
	readonly restaurantStatsTable: ddb.ITable
	readonly userPool: cognito.UserPool
	readonly identityPool: cognito.CfnIdentityPool
	readonly userPoolClient: cognito.UserPoolClient
	readonly iotPolicy: iot.CfnPolicy
	readonly simulatorConfig: { [key: string]: string | number, }
	readonly restaurantUserPassword: string
}

export class RestaurantGeneratorStepFunction extends cdk.Construct {
	public readonly lambda: lambda.Function

	public readonly stepFunction: step.StateMachine

	constructor (scope: cdk.Construct, id: string, props: RestaurantGeneratorStepFunctionProps) {
		super(scope, id)

		const {
			restaurantStatsTable,
			restaurantTable,
			identityPool,
			userPool,
			userPoolClient,
			iotPolicy,
			simulatorConfig,
			restaurantUserPassword,
		} = props

		this.lambda = new lambda.Function(this, 'RestaurantGeneratorHelper', {
			runtime: lambda.Runtime.NODEJS_12_X,
			functionName: namespaced(this, 'RestaurantGeneratorHelper'),
			description: 'Lambda used by step function to generate restaurants',
			code: lambda.Code.fromAsset(DeclaredLambdaFunction.getLambdaDistPath(__dirname, '@lambda/restaurant-generator-helper.zip')),
			handler: 'index.handler',
			timeout: cdk.Duration.seconds(120),
			environment: {
				RESTAURANT_STATS_TABLE_NAME: restaurantStatsTable.tableName,
				RESTAURANT_TABLE_NAME: restaurantTable.tableName,
				IDENTITY_POOL_ID: identityPool.ref,
				USER_POOL_ID: userPool.userPoolId,
				USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
				IOT_POLICY_NAME: iotPolicy.policyName || '',
				BASE_USERNAME: simulatorConfig.restaurantBaseUsername as string,
				USER_PASSWORD: restaurantUserPassword,
				DEMOGRAPHIC_AREAS: Object.values(DEMOGRAPHIC_AREA).join(','),
			},
			initialPolicy: [
				readDDBTablePolicyStatement(restaurantTable.tableArn),
				updateDDBTablePolicyStatement(restaurantTable.tableArn),
				deleteFromDDBTablePolicyStatement(restaurantTable.tableArn),
				readDDBTablePolicyStatement(restaurantStatsTable.tableArn),
				updateDDBTablePolicyStatement(restaurantStatsTable.tableArn),
				deleteFromDDBTablePolicyStatement(restaurantStatsTable.tableArn),
				new iam.PolicyStatement({
					effect: iam.Effect.ALLOW,
					actions: [
						// used by the simulator
						'iot:AttachPolicy',
						'iot:DetachPolicy',
					],
					resources: ['*'],
				}),
				new iam.PolicyStatement({
					resources: [userPool.userPoolArn],
					actions: [
						'cognito-idp:AdminUpdateUserAttributes',
						'cognito-idp:AdminConfirmSignUp',
						'cognito-idp:AdminDeleteUser',
					],
					effect: iam.Effect.ALLOW,
				}),
			],
		})

		const stepFunctionRole = new iam.Role(
			this,
			'stepFunctionRole',
			{
				assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
			},
		)
		stepFunctionRole.addToPolicy(
			new iam.PolicyStatement({
				actions: ['lambda:InvokeFunction', 'lambda:InvokeAsync'],
				effect: iam.Effect.ALLOW,
				resources: [this.lambda.functionArn],
			}),
		)

		const waitX = new step.Wait(this, 'Wait few Seconds', {
			time: step.WaitTime.duration(cdk.Duration.seconds(1)),
		})

		const iterate = new tasks.LambdaInvoke(
			this,
			'Iterator',
			{
				lambdaFunction: this.lambda,
				resultSelector: {
					'iterator.$': '$.Payload',
				},
				payload: {
					type: step.InputType.OBJECT,
					value: {
						cmd: 'iterate',
						payload: {
							'count.$': '$$.Execution.Input.batchSize',
							'index.$': '$.iterator.index',
							'step.$': '$.iterator.step',
						},
					},
				},
			},
		)

		const generateRestaurant = new tasks.LambdaInvoke(
			this,
			'GenerateRestaurant',
			{
				lambdaFunction: this.lambda,
				resultPath: step.JsonPath.DISCARD,
				payload: {
					type: step.InputType.OBJECT,
					value: {
						cmd: 'generateRestaurant',
						payload: {
							'restaurantStatsId.$': '$$.Execution.Input.restaurantStatsId',
							'lat.$': '$$.Execution.Input.lat',
							'long.$': '$$.Execution.Input.long',
							'area.$': '$$.Execution.Input.area',
							'radius.$': '$$.Execution.Input.radius',
						},
					},
				},
			},
		)

		const updateStats = (state: string): tasks.LambdaInvoke =>
			new tasks.LambdaInvoke(
				this,
				`UpdateStats_${state}`,
				{
					lambdaFunction: this.lambda,
					resultPath: step.JsonPath.DISCARD,
					payload: {
						type: step.InputType.OBJECT,
						value: {
							cmd: 'updateStats',
							payload: {
								'restaurantStatsId.$': '$$.Execution.Input.restaurantStatsId',
								state,
							},
						},
					},
				},
			)

		const configureCount = new step.Pass(this, 'ConfigureCount', {
			resultPath: '$.iterator',
			result: step.Result.fromObject({
				index: 0,
				step: 1,
			}),
		})

		const definition = configureCount
		.next(updateStats('IN_PROGRESS'))
		.next(iterate)
		.next(generateRestaurant)
		.next(
			new step.Choice(this, 'IsCountReached')
			.when(step.Condition.booleanEquals('$.iterator.continue', true), waitX.next(iterate))
			.otherwise(updateStats('READY')),
		)

		this.stepFunction = new step.StateMachine(this, 'RestaurantGeneratorStepFunctions', {
			stateMachineName: namespaced(this, 'RestaurantGeneratorStepFunctions'),
			definition,
			role: stepFunctionRole,
		})
	}
}
