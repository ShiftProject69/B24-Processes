import test from 'node:test';
import assert from 'node:assert/strict';
import BitrixProcesses from '../src/bitrixProcesses.js';

const now = '2026-11-26T09:14:00Z';
const old = { ID: 'old', TEMPLATE_ID: '42', MODULE_ID: 'crm', ENTITY: 'Deal',
	DOCUMENT_ID: 'DEAL_1', OWNED_UNTIL: '2026-11-26T09:02:00Z' };

function scenario(options = {}) {
	const calls = [];
	const delays = [];
	let running = [old];
	let attempts = 0;
	const client = new BitrixProcesses({
		portalUrl: 'https://unused.invalid', userId: '1', token: 'dummy',
		wait: async ms => { delays.push(ms); },
		async fetchClient(url, init) {
			const method = url.split('.').pop();
			const body = JSON.parse(init.body);
			calls.push({ method, body });
			let result;
			switch (method) {
				case 'instances':
					if (body.FILTER['<OWNED_UNTIL']) result = options.candidates ?? [old, old];
					else if (body.FILTER.ID) result = running.filter(r => r.ID === body.FILTER.ID)
						.map(r => ({ ...r, ...options.current }));
					else result = running;
					break;
				case 'list':
					result = [{ ID: '42', PARAMETERS: options.parameters ?? [] }];
					break;
				case 'terminate':
					if (!options.stillActive) running = [];
					result = !options.refuseStop;
					break;
				case 'start':
					attempts++;
					if (options.limited && attempts === 1) {
						return Response.json({ error: 'QUERY_LIMIT_EXCEEDED' }, { status: 429 });
					}
					if (options.lost) {
						if (options.visible) running.push({ ...old, ID: 'new' });
						throw new Error('connection lost');
					}
					result = options.emptyStart ? null : 'new';
					break;
				default: throw new Error('Unexpected method: ' + method);
			}
			return Response.json({ result });
		}
	});
	return { run: () => client.RestartStuckBizprocWorkflows({ now, dryRun: options.dryRun ?? false }),
		calls, delays, attempts: () => attempts };
}

test('checks lock, stops with STATUS, verifies stop and starts once on the original document', async () => {
	const s = scenario();
	const report = await s.run();
	assert.equal(report.total, 1);
	assert.equal(report.started[0].workflowId, 'new');
	assert.deepEqual(s.calls.map(c => c.method), ['instances','list','instances','instances','terminate','instances','start']);
	assert.deepEqual(s.calls[3].body.FILTER, { ID: 'old' });
	assert.match(s.calls[4].body.STATUS, /Блокировка.*09:02:00.*5 мин/);
	assert.deepEqual(s.calls[6].body, { TEMPLATE_ID: '42', DOCUMENT_ID: ['crm','Deal','DEAL_1'], PARAMETERS: {} });
});

for (const value of [null, 'invalid', '2026-11-26T09:09:00Z', now]) {
	test('skips cleared, invalid or fresh lock: ' + value, async () => {
		const s = scenario({ current: { OWNED_UNTIL: value } });
		assert.equal((await s.run()).skipped.length, 1);
		assert.ok(!s.calls.some(c => c.method === 'terminate'));
	});
}
test('dry run only reads candidates', async () => {
	const s = scenario({ dryRun: true });
	assert.equal((await s.run()).planned.length, 1);
	assert.equal(s.calls.length, 1);
});
test('missing mandatory input prevents termination', async () => {
	const s = scenario({ parameters: { owner: { Required: 'Y' } } });
	assert.equal((await s.run()).errors[0].stage, 'preflight');
	assert.ok(!s.calls.some(c => c.method === 'terminate'));
});
for (const options of [{ refuseStop: true }, { stillActive: true }]) {
	test('unconfirmed stop prevents start ' + JSON.stringify(options), async () => {
		const s = scenario(options);
		assert.equal((await s.run()).errors[0].stage, 'terminate');
		assert.equal(s.attempts(), 0);
	});
}
test('explicit rate limit permits one retry', async () => {
	const s = scenario({ limited: true });
	assert.equal((await s.run()).started.length, 1);
	assert.equal(s.attempts(), 2);
});
for (const options of [{ lost: true }, { emptyStart: true }, { lost: true, visible: true }]) {
	test('ambiguous start triggers reads only ' + JSON.stringify(options), async () => {
		const s = scenario(options);
		const r = await s.run();
		assert.equal(s.attempts(), 1);
		assert.equal(r.started.length, 0);
		assert.equal(r.observed.length, options.visible ? 1 : 0);
		assert.equal(r.errors.length, options.visible ? 0 : 1);
		assert.deepEqual(s.delays, options.visible ? [5000] : [5000, 15000]);
	});
}

test('continues processing after a template lookup fails for one candidate', async () => {
	const s = scenario({ candidates: [{ ...old, ID: 'other', TEMPLATE_ID: 'unknown' }, old] });
	const report = await s.run();
	assert.equal(report.errors[0].workflowId, 'other');
	assert.equal(report.started[0].sourceWorkflowId, 'old');
});
