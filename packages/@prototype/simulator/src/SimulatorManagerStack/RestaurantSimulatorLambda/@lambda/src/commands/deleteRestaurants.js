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
const utils = require('../utils')
const logger = require('../utils/logger')
const ddb = require('../lib/dynamoDB')
const step = require('../lib/steps')
const config = require('../config')

const execute = async (statsId) => {
	logger.info('Getting the restaurant stats for ID: ', statsId)

	const result = await ddb.get(config.restaurantStatsTable, statsId)
	const { Item } = result

	if (!Item) {
		return utils.fail({ message: `Restaurant stats with ID ${statsId} was not found` }, 400)
	}

	if (Item.state !== 'READY') {
		return utils.fail({ message: 'Cannot delete a restaurant set that is not in ready state' }, 400)
	}

	if (Item.state === 'DELETING') {
		return utils.fail({ message: 'The selected restaurant set is already on deleting phase' }, 400)
	}

	const simulation = await ddb.scan(config.restaurantSimulationTable, {
		state: 'RUNNING',
	})

	if (simulation.Count > 0) {
		return utils.fail({ message: 'You cannot delete the restaurants if there is a simulation running' }, 400)
	}

	await ddb.updateItem(config.restaurantStatsTable, statsId, {
		state: 'DELETING',
	})

	const res = await step.startExecution({
		restaurantStatsId: statsId,
		batchSize: config.restaurantDeleteBatchSize,
		area: result.Item.area,
	}, config.restaurantEraserStepFunctions)

	await ddb.updateItem(config.restaurantStatsTable, statsId, {
		deleteStepFunctionExecution: res.executionArn,
	})

	return utils.success({
		success: true,
	})
}

module.exports = {
	execute,
}
