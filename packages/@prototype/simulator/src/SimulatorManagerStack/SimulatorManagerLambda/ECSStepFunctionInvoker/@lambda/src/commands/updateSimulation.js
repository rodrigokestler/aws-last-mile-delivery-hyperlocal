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
const ddb = require('../lib/dynamoDB')
const config = require('../config')

const execute = async (payload) => {
	const { simulationId, tasks, failures } = payload
	const res = await ddb.get(config.simulatorTableName, simulationId)
	const { Item } = res

	if (!Item) {
		return {
			error: `Item with ID ${simulationId} was not found`,
		}
	}

	let taskArnPrefix = ''

	if (tasks.length > 0) {
		const parts = tasks[0].split('/')
		parts.pop()

		taskArnPrefix = parts.join('/')
	}

	await ddb.updateItem(config.simulatorTableName, simulationId, {
		taskArnPrefix,
		tasks: [
			...(Item.tasks || []),
			...tasks.map(q => q.split('/').pop()),
		],
		failures: [
			...(Item.failures || []),
			...failures,
		],
	})

	return { success: true }
}

module.exports = {
	execute,
}
