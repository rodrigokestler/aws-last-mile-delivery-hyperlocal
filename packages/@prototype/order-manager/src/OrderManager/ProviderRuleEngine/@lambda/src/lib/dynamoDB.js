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
const aws = require('aws-sdk')

const ddb = new aws.DynamoDB.DocumentClient()

const scan = (tableName, filterExpression = null, startKey = null, limit = 25) => {
	const filters = []
	const values = {}
	const names = {}

	if (filterExpression) {
		Object.keys(filterExpression).forEach((k) => {
			filters.push(`#${k} = :${k}`)

			values[`:${k}`] = filterExpression[k]
			names[`#${k}`] = k
		})
	}

	return ddb
	.scan({
		TableName: tableName,
		...(filterExpression ? {
			FilterExpression: filters.join(' AND '),
			ExpressionAttributeNames: names,
			ExpressionAttributeValues: values,
		} : {}),
		...(limit ? { Limit: limit } : {}),
		...(startKey ? { ExclusiveStartKey: { ID: startKey } } : {}),
	})
	.promise()
}

module.exports = {
	scan,
}
