import test from 'node:test';
import assert from 'node:assert/strict';
import BitrixClient from '../../../shared/bitrix/client.js';
import { FIELD_TYPES, syncConfig } from '../config.js';
import { CLIENT_ID, TAX_ID, companyMatcher, invoiceFields } from '../invoice.js';
import { Registry } from '../registry.js';
import { Fakturownia } from '../source.js';
import { InvoiceSync } from '../sync.js';
import { scheduleSync } from '../schedule.js';

const env = { FAKTUROWNIA_ACCOUNT: 'test', FAKTUROWNIA_TOKEN: 'dummy' };
const config = syncConfig(env);
const { fields } = config;
function invoice(id, kind = 'vat') {
	return { id, kind, token: 'document-' + id, income: true, number: 'FV/' + id, issue_date: '2026-01-01',
		payment_to: '2026-04-30', paid: '0.10', price_gross: '10.30', status: 'partial',
		currency: 'EUR', client_id: 22, buyer_tax_no: 'PL 001-23', buyer_name: 'Buyer',
		updated_at: '2026-01-01T10:00:00Z' };
}

function fixture(linkMode = 'crm') {
	const options = { ...config, linkMode };
	const state = { invoices: [invoice(1, 'proforma'), invoice(2), invoice(3)], companies: [],
		items: [], writes: [], pdfRequests: [], edges: [[1, 2]] };
	const metadata = { xmlId: {}, assignedById: { type: 'user' } };
	for (const [name, type] of Object.entries(FIELD_TYPES)) {
		const relation = ['bases', 'derived'].includes(name);
		metadata[fields[name]] = { type: relation ? linkMode : type, isMultiple: relation };
		if (type === 'crm') metadata[fields[name]].settings = { ['DYNAMIC_' + (name === 'company' ? 176 : options.entityTypeId)]: 'Y' };
		if (type === 'enumeration') {
			metadata[fields[name]].items = Object.values(name === 'kind' ? config.kinds : config.statuses).map(ID => ({ ID }));
		}
	}
	const bitrix = new BitrixClient({ portalUrl: 'https://crm.invalid', userId: '1', token: 'dummy',
		async fetchClient(url, init) {
			const method = new URL(url).pathname.split('/').at(-1);
			const { entityTypeId, fields: patch, id, filter, start, select } = JSON.parse(init.body);
			if (method === 'crm.item.fields') {
				const defs = entityTypeId === 176 ? { [CLIENT_ID]: {}, [TAX_ID]: {}, assignedById: { type: 'user' } } : metadata;
				return Response.json({ result: { fields: defs } });
			}
			if (method === 'crm.item.list') {
				assert.ok(select.includes('assignedById'));
				let rows = entityTypeId === 176 ? state.companies : state.items;
				if (filter['=xmlId']) rows = rows.filter(item => item.xmlId === filter['=xmlId']);
				return Response.json({ result: { items: rows.slice(start, start + 2) },
					next: rows.length > start + 2 ? start + 2 : undefined });
			}
			assert.ok(['crm.item.add', 'crm.item.update'].includes(method));
			state.writes.push(method);
			const card = id ? state.items.find(item => item.id === id) : { id: state.items.length + 101 };
			if (!id) state.items.push(card);
			assert.ok(!Object.hasOwn(patch, 'ufCrm353FsPdf'));
			Object.assign(card, patch);
			if (!id && state.loseAdd) {
				state.loseAdd = false;
				throw new Error('connection lost');
			}
			return Response.json({ result: { item: card } });
		}
	});
	const source = new Fakturownia(options, async (url, init) => {
		assert.equal(init.headers.Authorization, 'Bearer dummy');
		assert.ok(!String(url).includes('dummy'));
		if (url.pathname.endsWith('.pdf')) {
			state.pdfRequests.push(url.pathname);
			return new Response('%PDF-test');
		}
		const q = url.searchParams;
		assert.equal(q.get('period'), 'all');
		assert.equal(q.get('income'), 'yes');
		let rows = state.invoices;
		if (q.has('invoice_id') || q.has('from_invoice_id')) {
			if (state.failRelations) return new Response(null, { status: 503 });
			const bases = q.has('invoice_id');
			const id = Number(q.get(bases ? 'invoice_id' : 'from_invoice_id'));
			const refs = state.edges.filter(pair => pair[bases ? 1 : 0] === id).map(pair => pair[bases ? 0 : 1]);
			rows = rows.filter(row => refs.includes(row.id));
		}
		return Response.json(rows);
	});
	const registry = new Registry(bitrix, options);
	return { state, metadata, sync: new InvoiceSync(source, registry, options) };
}

for (const mode of ['crm', 'url']) {
	test('full import, replay and payment update with ' + mode + ' links', async () => {
		const { state, sync } = fixture(mode);
		state.loseAdd = true;
		const run = time => sync.run(new Date(time));
		const first = await run('2026-04-30T21:59:00Z');
		assert.deepEqual(first.errors, []);
		assert.equal(first.created, 3);
		assert.equal(first.unlinked, 3);
		const [base, child] = state.items;
		const link = id => mode === 'crm' ? String(id) : 'https://crm.invalid/crm/type/1404/details/' + id + '/';
		assert.equal(base.xmlId, 'fakturownia:test:1');
		assert.deepEqual(base[fields.derived] ?? [], []);
		assert.deepEqual(base[fields.bases] ?? [], []);
		assert.deepEqual(child[fields.bases], [link(base.id)]);
		assert.equal(child[fields.balance], '10.20|EUR');
		assert.equal(child[fields.overdue], 0);
		assert.equal(child[fields.nip], 'PL 001-23');
		const count = state.writes.length;
		assert.equal((await run('2026-04-30T21:59:00Z')).updated, 0);
		assert.equal(state.writes.length, count);
		assert.equal(state.pdfRequests.length, 0);
		assert.equal(child[fields.pdfUrl], 'https://test.fakturownia.pl/invoice/document-2.pdf');

		state.companies.push({ id: 42, [CLIENT_ID]: '22', [TAX_ID]: 'pl00123' });
		state.invoices[1].paid = '1.10';
		const next = await run('2026-04-30T22:01:00Z');
		assert.deepEqual(next.errors, []);
		assert.equal(next.created, 0);
		assert.equal(next.unlinked, 0);
		assert.equal(next.updated, 3);
		assert.equal(child[fields.balance], '9.20|EUR');
		assert.equal(child[fields.overdue], 1);
		assert.equal(child[fields.company], '42');
		assert.equal(state.pdfRequests.length, 0);
		state.invoices.pop();
		assert.deepEqual((await run('2026-05-02')).missing, ['3']);
		assert.equal(state.items.length, 3);
	});
}

test('refresh timestamp advances for selected invoices and freezes when they disappear', async () => {
	const { sync, state } = fixture();
	const first = '2026-05-01T07:00:00Z';
	const second = '2026-05-01T12:00:00Z';
	const third = '2026-05-02T07:00:00Z';
	await sync.run(new Date(first));
	const stamp = item => item[fields.syncedAt];
	assert.deepEqual(state.items.map(stamp), [first, first, first]);
	state.invoices.pop();
	const partial = await sync.run(new Date(second), { limit: 1 });
	assert.deepEqual(partial.missing, []);
	assert.deepEqual(state.items.map(stamp), [second, first, first]);
	const full = await sync.run(new Date(third));
	assert.equal(full.updated, 0);
	assert.deepEqual(full.missing, ['3']);
	assert.deepEqual(state.items.map(stamp), [third, third, first]);
	state.invoices.push(invoice(3));
	const restored = await sync.run(new Date('2026-05-02T12:00:00Z'));
	assert.equal(restored.created, 0);
	assert.deepEqual(restored.missing, []);
	assert.equal(stamp(state.items[2]), '2026-05-02T12:00:00Z');
});

test('uses detail metadata when the list omits the public token and rejects the account secret', async () => {
	let detail = { id: 8, token: 'public-eight' };
	const source = new Fakturownia(config, async url => {
		assert.equal(url.pathname, '/invoices/8.json');
		return Response.json(detail);
	});
	assert.equal(await source.pdfUrl({ id: 8 }), 'https://test.fakturownia.pl/invoice/public-eight.pdf');
	detail = { id: 8, token: null };
	assert.equal(await source.pdfUrl({ id: 8 }), '');
	await assert.rejects(source.pdfUrl({ id: 8, token: config.token }), /sharing token/);
});

test('rotated document token updates the URL once without fetching a file', async () => {
	const { state, sync } = fixture();
	await sync.run();
	state.invoices[0].token = 'new-public-token';
	assert.equal((await sync.run()).updated, 1);
	assert.equal(state.items[0][fields.pdfUrl], 'https://test.fakturownia.pl/invoice/new-public-token.pdf');
	assert.equal((await new InvoiceSync(sync.source, sync.registry, config).run()).updated, 0);
	assert.deepEqual(state.pdfRequests, []);
});

test('issue-date cutoff excludes old documents and clears cross-period VAT links', async () => {
	const { sync, state } = fixture();
	const old = { ...invoice(1, 'proforma'), issue_date: '2025-12-31' };
	const boundary = { ...invoice(2), issue_date: '2026-01-01', from_invoice_id: 1 };
	const later = { ...invoice(3), issue_date: '2026-01-02' };
	state.invoices = [old, boundary, later, { ...invoice(4), issue_date: '2025-01-01' }];
	state.edges = [[1, 3]];
	const legacy = { id: 80, xmlId: 'fakturownia:test:1', title: 'Existing proforma', [fields.issued]: old.issue_date };
	state.items.push({ ...legacy });
	const first = await sync.run();
	assert.equal(first.result, 'ok');
	assert.equal(first.created, 2);
	assert.deepEqual(state.pdfRequests, []);
	assert.deepEqual(state.items.map(card => card.xmlId), ['fakturownia:test:1', 'fakturownia:test:2', 'fakturownia:test:3']);
	for (const card of state.items.slice(1)) card[fields.bases] = ['80'];
	const replay = await sync.run();
	assert.equal(replay.result, 'ok');
	assert.equal(replay.updated, 2);
	assert.deepEqual(state.items[0], legacy);
	for (const card of state.items.slice(1)) assert.deepEqual(card[fields.bases], []);
	assert.equal((await sync.run()).updated, 0);
});

test('a document without a valid issue date cannot be imported or used as a basis', async () => {
	const { sync, state } = fixture();
	state.invoices = [{ ...invoice(1, 'proforma'), issue_date: '' }, { ...invoice(2), from_invoice_id: 1 },
		{ ...invoice(3), issue_date: '2026-02-30' }];
	const report = await sync.run();
	assert.deepEqual(report.errors.map(row => row.id), ['1', '3']);
	assert.equal(report.created, 1);
	assert.deepEqual(state.pdfRequests, []);
	assert.deepEqual(state.items[0][fields.bases] ?? [], []);
});

test('only VAT can point to its source proforma; clears obsolete and reverse links', async () => {
	const { state, sync } = fixture();
	state.invoices = [
		{ ...invoice(1, 'proforma'), from_invoice_id: 2 },
		{ ...invoice(2), from_invoice_id: '1' },
		{ ...invoice(3), from_invoice_id: 2 },
		...['advance', 'final', 'correction', 'bill'].map((kind, i) => ({ ...invoice(4 + i, kind), from_invoice_id: 1 }))
	];
	await sync.run();
	for (const card of state.items) {
		card[fields.bases] = ['103', '102'];
		card[fields.derived] = ['102'];
	}
	assert.equal((await sync.run()).result, 'ok');
	for (const card of state.items) {
		assert.deepEqual(card[fields.derived], []);
		assert.deepEqual(card[fields.bases], card.id === 102 ? ['101'] : []);
	}
	assert.equal((await sync.run()).updated, 0);
});

test('conflicting VAT claims and missing or inactive proformas require review', async () => {
	const { state, sync } = fixture();
	await sync.run();
	state.invoices[2].from_invoice_id = 1;
	const conflict = await sync.run();
	assert.equal(conflict.result, 'review');
	assert.deepEqual(conflict.linkReview, [{ sourceId: '1', invoiceIds: ['2', '3'], reason: 'multiple_vat' }]);
	assert.deepEqual(state.items[1][fields.bases], []);
	assert.deepEqual(state.items[2][fields.bases] ?? [], []);
	state.invoices[0].cancelled = true;
	state.invoices[2].from_invoice_id = 999;
	const review = await sync.run();
	assert.deepEqual(review.linkReview.map(row => row.reason).sort(), ['inactive_proforma', 'unresolved_source']);
	assert.deepEqual(state.items[1][fields.bases], []);
});

test('failed source lookup preserves links until a successful retry', async () => {
	const { state, sync } = fixture();
	await sync.run();
	state.edges = [];
	state.failRelations = true;
	assert.equal((await sync.run()).errors[0].stage, 'links');
	assert.deepEqual(state.items[1][fields.bases], ['101']);
	state.failRelations = false;
	assert.equal((await sync.run()).updated, 1);
	assert.deepEqual(state.items[1][fields.bases], []);
});

test('incomplete configuration or wrong portal fields prevent writes', async () => {
	assert.throws(() => syncConfig({ ...env, FAKTUROWNIA_TOKEN: '' }), /TOKEN/);
	assert.throws(() => syncConfig({ ...env, FAKTUROWNIA_ACCOUNT: '' }), /ACCOUNT/);
	const { metadata, sync, state } = fixture();
	delete metadata[fields.status];
	assert.equal((await sync.run()).errors[0].stage, 'registry');
	assert.equal(state.writes.length, 0);
});

test('matches a unique customer, rejects conflicting or ambiguous evidence', () => {
	const row = (id, client, tax) => ({ id, [CLIENT_ID]: client, [TAX_ID]: tax });
	const check = rows => companyMatcher(rows)(invoice(1))?.id ?? 0;
	assert.equal(check([row(1, 22, '')]), 1);
	assert.equal(check([row(1, '', 'pl00123')]), 1);
	assert.equal(check([row(1, 23, 'PL00123')]), 0);
	assert.equal(check([row(1, 22, 'OTHER'), row(2, '', 'PL00123')]), 0);
	assert.equal(check([row(1, 22, 'PL00123'), row(2, 22, '')]), 0);
	assert.equal(check([row(1, '', 'PL00123'), row(2, '', 'PL00123')]), 0);
});

test('clears the custom company binding when the next reconciliation finds a conflict', async () => {
	const { sync, state } = fixture();
	state.companies = [{ id: 42, [CLIENT_ID]: '22', [TAX_ID]: 'PL00123' }];
	await sync.run();
	const card = state.items[0];
	assert.equal(card[fields.company], '42');
	state.companies[0][TAX_ID] = 'DIFFERENT';
	const result = await sync.run();
	assert.deepEqual(result.errors, []);
	assert.equal(result.unlinked, 3);
	assert.equal(card[fields.company], '');
	assert.equal(card[fields.buyer], 'Buyer');
	assert.ok(!Object.hasOwn(card, 'parentId176'));
});

test('inherits company owner by NIP on creation and reapplies the current owner within the run limit', async () => {
	const { sync, state } = fixture();
	state.companies = [{ id: 42, [TAX_ID]: 'PL00123', assignedById: '7' }];
	state.loseAdd = true;
	const now = new Date('2026-05-01T07:00:00Z');
	assert.deepEqual((await sync.run(now)).errors, []);
	assert.deepEqual(state.items.map(card => card.assignedById), [7, 7, 7]);
	state.companies[0].assignedById = 12;
	const limited = await sync.run(now, { limit: 1 });
	assert.equal(limited.updated, 1);
	assert.deepEqual(state.items.map(card => card.assignedById), [12, 7, 7]);
	state.items[0].assignedById = 99;
	assert.equal((await sync.run(now)).updated, 3);
	assert.deepEqual(state.items.map(card => card.assignedById), [12, 12, 12]);
	state.items[0].assignedById = '12';
	const writes = state.writes.length;
	assert.equal((await sync.run(now)).updated, 0);
	assert.equal(state.writes.length, writes);
});

test('retains manual owners and leaves the default on creation when a company or its owner is unavailable', async () => {
	const { sync, state } = fixture();
	assert.deepEqual((await sync.run()).errors, []);
	assert.ok(state.items.every(card => !Object.hasOwn(card, 'assignedById')));
	state.items[0].assignedById = 17;
	const company = { id: 42, [CLIENT_ID]: 22, assignedById: 0 };
	state.companies = [company];
	await sync.run();
	assert.equal(state.items[0][fields.company], '42');
	assert.equal(state.items[0].assignedById, 17);
	company.assignedById = 7;
	state.companies.push({ ...company, id: 43 });
	const ambiguous = await sync.run();
	assert.equal(ambiguous.unlinked, 3);
	assert.equal(state.items[0].assignedById, 17);
});

test('backs off after a source read is rate limited', async () => {
	const waits = [];
	let calls = 0;
	const source = new Fakturownia(config, async () => {
		if (++calls === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '3' } });
		return Response.json([]);
	}, async ms => waits.push(ms));
	for await (const row of source.invoices()) assert.fail('unexpected document ' + row.id);
	assert.deepEqual(waits, [3000]);
	assert.equal(calls, 2);
});

test('overdue is independent of partial payment and excludes inactive documents', () => {
	for (const status of ['paid', 'rejected', 'cancelled']) {
		const data = { ...invoice(1), status: status === 'cancelled' ? 'issued' : status, cancelled: status === 'cancelled' };
		const values = invoiceFields(data, 0, '2026-05-01', config);
		assert.equal(values[fields.overdue], 0);
		assert.equal(values[fields.status], config.statuses[status]);
	}
	assert.throws(() => invoiceFields({ ...invoice(1), paid: null }, 0, '2026-05-01', config), /partial/);
});

test('reads past a full source page and skips expenses', async () => {
	const pages = [];
	const api = new Fakturownia(config, async url => {
		const page = Number(url.searchParams.get('page'));
		pages.push(page);
		return Response.json(page === 1 ? Array.from({ length: 100 }, (_, i) => invoice(i + 1)) :
			[{ ...invoice(101), income: false }, invoice(102)]);
	});
	const ids = [];
	for await (const row of api.invoices()) ids.push(row.id);
	assert.deepEqual(pages, [1, 2]);
	assert.equal(ids.length, 101);
	assert.equal(ids.at(-1), 102);
});

test('daily Warsaw schedule skips overlapping executions', () => {
	let call;
	scheduleSync({}, { schedule(...args) { call = args; } });
	assert.equal(call[0], '0 9,14 * * *');
	assert.equal(call[2].timezone, 'Europe/Warsaw');
	assert.equal(call[2].noOverlap, true);
});

test('limited run only writes the earliest eligible cards, including the links pass', async () => {
	const { state, sync } = fixture();
	state.invoices = [invoice(12), invoice(3), invoice(2, 'proforma'), { ...invoice(1), issue_date: '2026-01-02' }];
	state.edges = [[2, 3], [2, 12]];
	const untouched = { id: 90, title: 'Keep', xmlId: 'fakturownia:test:12', [fields.derived]: ['81'] };
	state.items = [{ ...untouched }];
	const report = await sync.run(new Date('2026-11-26'), { limit: 2 });
	assert.deepEqual(report.selected, ['2', '3']);
	assert.deepEqual(report.errors, []);
	assert.equal(report.created, 2);
	assert.equal(report.linkReview[0].reason, 'multiple_vat');
	assert.equal(state.items.length, 3);
	assert.deepEqual(state.items[0], untouched);
	assert.equal(syncConfig({ ...env, FAKTUROWNIA_ACCOUNT: 'https://test.fakturownia.pl/' }).account, 'test');
});
