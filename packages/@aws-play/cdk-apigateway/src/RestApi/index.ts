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
import { IApiKey, EndpointType, LambdaIntegration, MethodOptions, IResource, RestApi as CdkRestApi, RestApiProps as CdkRestApiProps, CfnAuthorizer, AuthorizationType } from '@aws-cdk/aws-apigateway'
import { ManagedPolicy, Role, ServicePrincipal } from '@aws-cdk/aws-iam'
import { IFunction, Function as LambdaFunction, FunctionProps } from '@aws-cdk/aws-lambda'
import { NodejsFunction, NodejsFunctionProps } from '@aws-cdk/aws-lambda-nodejs'
import { Construct } from '@aws-cdk/core'
import { ServicePrincipals, ManagedPolicies } from 'cdk-constants'
import { namespaced, uniqueIdHash } from '@aws-play/cdk-core'

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface RestApiProps extends CdkRestApiProps {}

interface BaseFunctionToResourceProps {
	httpMethod: string
	methodOptions?: MethodOptions
}

export interface CreateFunctionToResourceProps extends BaseFunctionToResourceProps{
	functionId: string
	functionProps: FunctionProps | NodejsFunctionProps
}

export interface AddFunctionToResourceProps extends BaseFunctionToResourceProps {
	function: IFunction
}

export class RestApi extends CdkRestApi {
	private static defaultProps ({ endpointTypes, ...props }: RestApiProps): RestApiProps {
		return {
			...props,
			endpointTypes: endpointTypes || [EndpointType.REGIONAL],
		}
	}

	constructor (scope: Construct, id: string, props: RestApiProps) {
		super(scope, id, RestApi.defaultProps(props))

		// dummy
		this.root.addMethod('ANY')

		let { restApiName } = props

		if (!restApiName) {
			restApiName = `restApi-${uniqueIdHash(this)}`
		}
	}

	addApiKeyWithUsagePlanAndStage (apiKeyId: string, usagePlanName?: string): IApiKey {
		const _usagePlanName = usagePlanName || `${apiKeyId}-usagePlan`

		// create the api key
		const apiKey = this.addApiKey(`${apiKeyId}-${uniqueIdHash(this)}`, {
			apiKeyName: namespaced(this, apiKeyId),
		})

		// usage plan
		const usagePlan = this.addUsagePlan(`${apiKeyId}-usagePlan`, {
			name: _usagePlanName,
			apiKey,
		})

		// stage
		usagePlan.addApiStage({ api: this, stage: this.deploymentStage })

		return apiKey
	}

	addResourceWithAbsolutePath (path: string): IResource {
		return this.root.resourceForPath(path)
	}

	addCognitoAuthorizer (providerArns: string[]): CfnAuthorizer {
		// add cognito authorizer
		const cognitoAuthorizer = new CfnAuthorizer(this, `CognitoAuthorizer-${uniqueIdHash(this)}`, {
			name: namespaced(this, 'CognitoAuthorizer'),
			identitySource: 'method.request.header.Authorization',
			providerArns,
			restApiId: this.restApiId,
			type: AuthorizationType.COGNITO,
		})

		return cognitoAuthorizer
	}

	// helper for add*FunctionToResource
	private createDefaultLambdaRole (id: string, functionName: string): Role {
		return new Role(this, `${id}-role-${uniqueIdHash(this)}`, {
			assumedBy: new ServicePrincipal(ServicePrincipals.LAMBDA),
			description: `Execution role for ${functionName}`,
			managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName(ManagedPolicies.AWS_LAMBDA_EXECUTE)],
			roleName: namespaced(this, functionName),
		})
	}

	private createFunctionToResource<TProps extends FunctionProps | NodejsFunctionProps> (
		resource: IResource,
		props: CreateFunctionToResourceProps,
		FnType: { new(scope: Construct, id: string, fnProps: TProps): IFunction, },
	): IFunction {
		const { httpMethod, functionId, functionProps, methodOptions } = props

		const { functionName, role } = functionProps

		if (functionName === undefined) {
			throw new Error('You need to provide a functionName property')
		}

		let lambdaExecutionRole

		if (role === undefined) {
			lambdaExecutionRole = this.createDefaultLambdaRole(functionId, functionName)
		}

		const lambdaFunctionProps = {
			...functionProps as TProps,
			role: role || lambdaExecutionRole,
			functionName: namespaced(this, functionName),
		}

		const lambdaFunction = new FnType(this, `${functionId}-fn-${uniqueIdHash(this)}`, lambdaFunctionProps)

		this.addFunctionToResource(resource, {
			httpMethod,
			methodOptions,
			function: lambdaFunction,
		})

		return lambdaFunction
	}

	addFunctionToResource (resource: IResource, props: AddFunctionToResourceProps): void {
		const { httpMethod, methodOptions, function: lambdaFunction } = props

		const lambdaIntegration = new LambdaIntegration(lambdaFunction)
		resource.addMethod(httpMethod, lambdaIntegration, methodOptions)
	}

	createLambdaFunctionToResource (resource: IResource, props: CreateFunctionToResourceProps): IFunction {
		const { functionProps } = props

		if ((functionProps as FunctionProps) === undefined) {
			throw new Error('functionProps must be of type FunctionProps')
		}

		return this.createFunctionToResource(resource, props, LambdaFunction)
	}

	createNodejsFunctionToResource (resource: IResource, props: CreateFunctionToResourceProps): IFunction {
		const { functionProps } = props

		if ((functionProps as NodejsFunctionProps) === undefined) {
			throw new Error('functionProps must be of type NodejsFunctionProps')
		}

		return this.createFunctionToResource(resource, props, NodejsFunction)
	}
}
