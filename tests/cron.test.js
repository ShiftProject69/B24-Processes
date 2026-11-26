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

test('ScheduleRestartStuckBizprocWorkflows schedules restart at 08:00 and 18:00 Poland time', async () => {
	const oCronClient = CreateFakeCron();
	const aCalls = [];
	const oCron = new Cron({
		Bitrix: {
			async RestartStuckBizprocWorkflows(oOptions) {
				aCalls.push(oOptions);
				return { total: 0, skipped: [], terminated: [], started: [], observed: [], errors: [] };
			}
		},
		Cron: oCronClient,
		stuckMinutes: 7
	});

	oCron.ScheduleRestartStuckBizprocWorkflows();
	await oCronClient.schedules[0].handler();

	assert.equal(oCronClient.schedules[0].expression, '0 8,18 * * *');
	assert.equal(oCronClient.schedules[0].options.timezone, 'Europe/Warsaw');
	assert.deepEqual(aCalls[0], {
		dryRun: false,
		stuckMinutes: 7
	});
});

test('ScheduleAll registers only the workflow restart job', () => {
	const oCronClient = CreateFakeCron();
	const oCron = new Cron({
		Bitrix: {
			async RestartStuckBizprocWorkflows() {}
		},
		Cron: oCronClient
	});

	oCron.ScheduleAll();

	assert.deepEqual(
		oCronClient.schedules.map(oSchedule => oSchedule.expression),
		['0 8,18 * * *']
	);
});
