import test from 'node:test';
import assert from 'node:assert/strict';

import Cron from '../src/cron.js';

function CreateFakeCron() {
	const schedules = [];
	return {
		schedules,
		schedule(expression, handler, options) {
			const task = { expression, handler, options };
			schedules.push(task);
			return task;
		}
	};
}

test('ScheduleExRatesUpdate schedules PLN exchange rates update at 01:00 Poland time', async () => {
	const oCronClient = CreateFakeCron();
	const aCalls = [];
	const oBitrix = {
		async UpdatePlnExchangeRates(oDate) {
			aCalls.push(oDate);
		}
	};
	const oCron = new Cron({
		Bitrix: oBitrix,
		Cron: oCronClient
	});

	oCron.ScheduleExRatesUpdate();
	await oCronClient.schedules[0].handler();

	assert.equal(oCronClient.schedules[0].expression, '0 1 * * *');
	assert.equal(oCronClient.schedules[0].options.timezone, 'Europe/Warsaw');
	assert.equal(aCalls.length, 1);
	assert.equal(aCalls[0] instanceof Date, true);
});

test('ScheduleExRatesUpdate logs Bitrix update failures', async () => {
	const oCronClient = CreateFakeCron();
	const oError = new Error('failed');
	const aErrors = [];
	const oCron = new Cron({
		Bitrix: {
			async UpdatePlnExchangeRates() {
				throw oError;
			}
		},
		Cron: oCronClient,
	});

	oCron.ScheduleExRatesUpdate();
	await oCronClient.schedules[0].handler();

	assert.equal(aErrors.length, 1);
	assert.equal(aErrors[0][0], 'Обновление Exchange Rates в Bitrix24 провалилось:');
	assert.equal(aErrors[0][1], oError);
});

test('ScheduleRestartStuckBizprocWorkflows schedules restart at 11:00 Poland time', async () => {
	const oCronClient = CreateFakeCron();
	const aCalls = [];
	const oCron = new Cron({
		Bitrix: {
			async RestartStuckBizprocWorkflows(oOptions) {
				aCalls.push(oOptions);
			}
		},
		Cron: oCronClient,
		templateId: '123',
		stuckMinutes: 7
	});

	oCron.ScheduleRestartStuckBizprocWorkflows();
	await oCronClient.schedules[0].handler();

	assert.equal(oCronClient.schedules[0].expression, '0 11 * * *');
	assert.equal(oCronClient.schedules[0].options.timezone, 'Europe/Warsaw');
	assert.deepEqual(aCalls[0], {
		dryRun: false,
		templateId: '123',
		stuckMinutes: 7
	});
});

test('ScheduleAll registers both Bitrix cron jobs', () => {
	const oCronClient = CreateFakeCron();
	const oCron = new Cron({
		Bitrix: {
			async UpdatePlnExchangeRates() {},
			async RestartStuckBizprocWorkflows() {}
		},
		Cron: oCronClient
	});

	oCron.ScheduleAll();

	assert.deepEqual(
		oCronClient.schedules.map(oSchedule => oSchedule.expression),
		['0 1 * * *', '0 11 * * *']
	);
});
