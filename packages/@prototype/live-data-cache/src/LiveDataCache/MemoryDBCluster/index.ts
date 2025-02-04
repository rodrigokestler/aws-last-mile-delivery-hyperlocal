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
/* eslint-disable no-console */
import { Construct } from 'constructs'
import { aws_memorydb as memorydb, aws_ec2 as ec2, aws_secretsmanager as secrets } from 'aws-cdk-lib'
import { namespaced } from '@aws-play/cdk-core'

export interface MemoryDBClusterProps {
	readonly adminUsername: string
	readonly adminAccessString?: string
	readonly numShards?: number
	readonly numReplicasPerShard?: number
	readonly nodeType?: string
	readonly vpc: ec2.IVpc
	readonly securityGroups: ec2.ISecurityGroup[]
}

export class MemoryDBCluster extends Construct {
	readonly cluster: memorydb.CfnCluster

	readonly adminUsername: string

	readonly adminPasswordSecret: secrets.Secret

	constructor (scope: Construct, id: string, props: MemoryDBClusterProps) {
		super(scope, id)

		const {
			vpc,
			securityGroups,
			nodeType,
			numShards,
			numReplicasPerShard,
			adminUsername,
			adminAccessString,
		} = props

		const commonName = namespaced(this, 'live-data', { lowerCase: true }) // NOTE: lowercase

		const subnetGroup = new memorydb.CfnSubnetGroup(this, 'MemoryDBClusterSubnetGroup', {
			subnetGroupName: commonName,
			description: 'Subnet for LiveData MemoryDBCluster',
			subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
		})
		const adminPasswordSecret = new secrets.Secret(this, 'MemoryDBClusterPassword', {
			description: `The password used by the memorydb user: ${adminUsername}`,
		})

		const adminUser = new memorydb.CfnUser(this, 'MemoryDBAdminUser', {
			/// access to everything by default. see https://redis.io/topics/acl for more details
			accessString: adminAccessString || 'on ~* &* +@all',
			authenticationMode: {
				Passwords: [adminPasswordSecret.secretValue.toString()],
				Type: 'password',
			},
			userName: adminUsername,
		})

		const acl = new memorydb.CfnACL(this, 'MemoryDBACL', {
			aclName: commonName,
			userNames: [adminUser.userName],
		})
		acl.addDependsOn(adminUser)

		const cluster = new memorydb.CfnCluster(this, 'MemoryDBCluster', {
			aclName: acl.ref,
			clusterName: commonName,
			// eslint-disable-next-line max-len
			// https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/CacheNodes.SupportedTypes.html#CacheNodes.SupportedTypesByRegion
			nodeType: nodeType || 'cache.t3.medium',
			autoMinorVersionUpgrade: true,
			description: 'MemDB for Hyperlocal',
			numReplicasPerShard: numReplicasPerShard || 1,
			numShards: numShards || 1,
			parameterGroupName: 'default.memorydb-redis6', // exists by default in the account [?]
			securityGroupIds: securityGroups.map(group => group.securityGroupId),
			subnetGroupName: subnetGroup.ref,
			tlsEnabled: true,
			port: 6379,
		})

		cluster.node.addDependency(subnetGroup)

		this.cluster = cluster
		this.adminUsername = adminUsername
		this.adminPasswordSecret = adminPasswordSecret
	}
}

export type MemoryDBClusterType = typeof MemoryDBCluster
