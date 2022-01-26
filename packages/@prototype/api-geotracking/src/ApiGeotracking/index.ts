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
import { Construct } from '@aws-cdk/core'
import { ApiKey, AuthorizationType, CognitoUserPoolsAuthorizer, IApiKey, RequestValidator } from '@aws-cdk/aws-apigateway'
import { IUserPool, IUserPoolClient } from '@aws-cdk/aws-cognito'
import { IFunction, ILayerVersion } from '@aws-cdk/aws-lambda'
import { RestApi } from '@aws-play/cdk-apigateway'
import { namespaced } from '@aws-play/cdk-core'
import { IVpc, ISecurityGroup } from '@aws-cdk/aws-ec2'
import { CfnCacheCluster } from '@aws-cdk/aws-elasticache'
import HTTPMethod from 'http-method-enum'
import { GetDriverLocationLambda } from './GetDriverLocation'
import { QueryDriversLambda } from './QueryDrivers'
import { ListDriversForPolygonLambda } from './ListDriversForPolygon'
import { ITable } from '@aws-cdk/aws-dynamodb'
import { IDomain } from '@aws-cdk/aws-elasticsearch'
import { GetDemAreaSettingsLambda } from './GetDemAreaSettings'

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ApiGeoTrackingProps {
	readonly restApi: RestApi
	readonly apiPrefix?: string
	readonly userPool: IUserPool
	readonly lambdaLayers: { [key: string]: ILayerVersion, }
	readonly vpc: IVpc
	readonly lambdaSecurityGroups: ISecurityGroup[]
	readonly redisCluster: CfnCacheCluster
	readonly geoPolygonTable: ITable
	readonly demographicAreaDispatchSettings: ITable
	readonly esDomain: IDomain
}

export class ApiGeoTracking extends Construct {
	readonly userPoolClient: IUserPoolClient

	readonly geoTrackingApiKey: IApiKey

	readonly queryDrivers: IFunction

	constructor (scope: Construct, id: string, props: ApiGeoTrackingProps) {
		super(scope, id)

		const {
			restApi,
			apiPrefix = 'api/geotracking',
			lambdaLayers,
			userPool,
			vpc, lambdaSecurityGroups, redisCluster,
			geoPolygonTable,
			demographicAreaDispatchSettings,
			esDomain,
		} = props

		const cognitoAuthorizer = new CognitoUserPoolsAuthorizer(this, 'GeoTrackingApiCognitoAuthorizer', {
			authorizerName: namespaced(this, 'GeoTrackingApiCognitorAuthorizer'),
			cognitoUserPools: [userPool],
		})

		// add UserPool client
		const userPoolClient = userPool.addClient('GeoTrackingApiUserPoolClient', {
			userPoolClientName: namespaced(this, 'GeoTrackingApi-Client'),
			authFlows: {
				userPassword: true,
				userSrp: true,
				adminUserPassword: true,
			},
		})

		this.userPoolClient = userPoolClient

		const geoTrackingApiKey = restApi.addApiKeyWithUsagePlanAndStage(namespaced(restApi, 'ApiKey-GeoTrackingApi'))
		this.geoTrackingApiKey = geoTrackingApiKey

		// GetDriverLocation
		const getDriverLocationEndpoint = restApi.addResourceWithAbsolutePath(`${apiPrefix}/driver-location/id/{driverId}`)
		const getDriverLocationLambda = new GetDriverLocationLambda(restApi, 'GetDriverLocationLambda', {
			dependencies: {
				vpc,
				lambdaSecurityGroups,
				redisCluster,
				lambdaLayers: [
					lambdaLayers.lambdaUtilsLayer,
					lambdaLayers.redisClientLayer,
					lambdaLayers.esClientLayer,
					lambdaLayers.lambdaInsightsLayer,
				],
			},
		})
		restApi.addFunctionToResource(getDriverLocationEndpoint, {
			function: getDriverLocationLambda,
			httpMethod: HTTPMethod.GET,
			methodOptions: {
				authorizer: cognitoAuthorizer,
			},
		})
		const getDriverLocationEndpointInternal = restApi.addResourceWithAbsolutePath(`${apiPrefix}/internal/driver-location/id/{driverId}`)
		restApi.addFunctionToResource(getDriverLocationEndpointInternal, {
			function: getDriverLocationLambda,
			httpMethod: HTTPMethod.GET,
			methodOptions: {
				apiKeyRequired: true,
			},
		})

		// queryDrivers
		const queryDriversEndpoint = restApi.addResourceWithAbsolutePath(`${apiPrefix}/driver-location/query/`)
		const queryDriversLambda = new QueryDriversLambda(restApi, 'QueryDriversLambda', {
			dependencies: {
				vpc,
				lambdaSecurityGroups,
				redisCluster,
				lambdaLayers: [
					lambdaLayers.lambdaUtilsLayer,
					lambdaLayers.redisClientLayer,
					lambdaLayers.esClientLayer,
					lambdaLayers.lambdaInsightsLayer,
				],
			},
		})
		const queryDriversRequestValidator = new RequestValidator(this, 'QueryDriversLambdaReqValidator',
			{
				restApi,
				requestValidatorName: namespaced(this, 'QueryDriversLambdaReqValidator'),
				validateRequestParameters: true,
			},
		)
		const queryDriversRequestParameters = {
			'method.request.querystring.status': false,
			'method.request.querystring.shape': false, // 'circle' | 'box'
			'method.request.querystring.lat': true,
			'method.request.querystring.long': true,
			'method.request.querystring.distance': true,
			'method.request.querystring.distanceUnit': false, // default: 'm'
		}

		restApi.addFunctionToResource(queryDriversEndpoint, {
			function: queryDriversLambda,
			httpMethod: HTTPMethod.GET,
			methodOptions: {
				authorizer: cognitoAuthorizer,
				requestParameters: queryDriversRequestParameters,
				requestValidator: queryDriversRequestValidator,
			},
		})
		const queryDriversEndpointInternal = restApi.addResourceWithAbsolutePath(`${apiPrefix}/internal/driver-location/query/`)
		restApi.addFunctionToResource(queryDriversEndpointInternal, {
			function: queryDriversLambda,
			httpMethod: HTTPMethod.GET,
			methodOptions: {
				apiKeyRequired: true,
				requestParameters: queryDriversRequestParameters,
				requestValidator: queryDriversRequestValidator,
			},
		})
		restApi.addFunctionToResource(queryDriversEndpointInternal, {
			function: queryDriversLambda,
			httpMethod: HTTPMethod.POST,
			methodOptions: {
				apiKeyRequired: true,
			},
		})

		// listDriversForPolygon
		const listDriversForPolygonWithIdEndpoint = restApi.addResourceWithAbsolutePath(`${apiPrefix}/driver-location/polygon/{polygonId}`)
		const listDriversForPolygonEndpoint = restApi.addResourceWithAbsolutePath(`${apiPrefix}/driver-location/polygon/`)
		const listDriversForPolygonLambda = new ListDriversForPolygonLambda(restApi, 'ListDriversForPolygonLambda', {
			dependencies: {
				vpc,
				lambdaSecurityGroups,
				redisCluster,
				lambdaLayers: [
					lambdaLayers.lambdaUtilsLayer,
					lambdaLayers.redisClientLayer,
					lambdaLayers.esClientLayer,
					lambdaLayers.lambdaInsightsLayer,
				],
				geoPolygonTable,
				esDomain,
			},
		})
		restApi.addFunctionToResource(listDriversForPolygonWithIdEndpoint, {
			function: listDriversForPolygonLambda,
			httpMethod: HTTPMethod.GET,
			methodOptions: {
				authorizer: cognitoAuthorizer,
			},
		})
		restApi.addFunctionToResource(listDriversForPolygonEndpoint, {
			function: listDriversForPolygonLambda,
			httpMethod: HTTPMethod.POST,
			methodOptions: {
				authorizer: cognitoAuthorizer,
			},
		})

		const listDriversForPolygonWithIdEndpointInternal = restApi.addResourceWithAbsolutePath(`${apiPrefix}/internal/driver-location/polygon/{polygonId}`)
		const listDriversForPolygonEndpointInternal = restApi.addResourceWithAbsolutePath(`${apiPrefix}/internal/driver-location/polygon/`)
		restApi.addFunctionToResource(listDriversForPolygonWithIdEndpointInternal, {
			function: listDriversForPolygonLambda,
			httpMethod: HTTPMethod.GET,
			methodOptions: {
				apiKeyRequired: true,
			},
		})
		restApi.addFunctionToResource(listDriversForPolygonEndpointInternal, {
			function: listDriversForPolygonLambda,
			httpMethod: HTTPMethod.POST,
			methodOptions: {
				apiKeyRequired: true,
			},
		})

		this.queryDrivers = queryDriversLambda

		const getDemAreaSettingsEndpointInternal = restApi.addResourceWithAbsolutePath(`${apiPrefix}/internal/dem-area-settings`)
		const getDemAreaSettingsLambda = new GetDemAreaSettingsLambda(this, 'GetDemAreaSettingsLambda', {
			dependencies: {
				vpc,
				lambdaSecurityGroups,
				lambdaLayers: [
					lambdaLayers.lambdaUtilsLayer,
					lambdaLayers.lambdaInsightsLayer,
				],
				demographicAreaDispatchSettings,
			},
		})
		restApi.addFunctionToResource(getDemAreaSettingsEndpointInternal, {
			function: getDemAreaSettingsLambda,
			httpMethod: HTTPMethod.GET,
			methodOptions: {
				apiKeyRequired: true,
			},
		})
	}
}
