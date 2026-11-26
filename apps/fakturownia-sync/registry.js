import { setTimeout as delay } from 'node:timers/promises';
import { FIELD_TYPES } from './config.js';
import { CLIENT_ID, TAX_ID } from './invoice.js';

export class Registry {
	constructor(bitrix, config) {
		this.bitrix = bitrix;
		this.config = config;
		this.select = ['id', 'xmlId', 'title', 'assignedById', ...Object.values(config.fields)];
	}

	async call(method, payload) {
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.bitrix.DoRequest(method, payload);
			} catch (error) {
				if (attempt >= 2 || error.code !== 'QUERY_LIMIT_EXCEEDED') {
					// Upstream descriptions can contain field values or authenticated URLs.
					throw new Error(method + ' failed' + (error.status ? ' (HTTP ' + error.status + ')' : ''));
				}
				await delay(2000 * (attempt + 1));
			}
		}
	}

	async checkSchema() {
		const { entityTypeId, fields, linkMode, kinds, statuses } = this.config;
		const response = await this.call('crm.item.fields', { entityTypeId });
		const actual = response.result?.fields;
		if (!actual?.xmlId) throw new Error('Missing invoice xmlId');
		const assignee = actual.assignedById;
		if (assignee?.type !== 'user' || assignee.isReadOnly || assignee.isImmutable || assignee.isMultiple) {
			throw new Error('Check write access for invoice assignedById');
		}
		for (const [key, type] of Object.entries(FIELD_TYPES)) {
			const relation = key === 'bases' || key === 'derived';
			const field = actual[fields[key]];
			if (field?.type !== (relation ? linkMode : type) || Boolean(field.isMultiple) !== relation ||
				field.isReadOnly) throw new Error('Check type, multiplicity and write access for ' + key);
			if (field.type === 'crm') {
				const target = 'DYNAMIC_' + (key === 'company' ? 176 : entityTypeId);
				const allowed = Object.entries(field.settings ?? {}).filter(([, value]) => value === 'Y');
				if (allowed.length !== 1 || allowed[0][0] !== target) throw new Error('Check CRM target for ' + key);
			}
			if (type === 'enumeration') {
				const ids = new Set((field.items ?? []).map(item => String(item.ID ?? item.id)));
				const values = Object.values(key === 'kind' ? kinds : statuses);
				if (values.some(id => !ids.has(String(id)))) throw new Error('Check list options for ' + key);
			}
		}
		const company = await this.call('crm.item.fields', { entityTypeId: 176 });
		for (const code of [CLIENT_ID, TAX_ID, 'assignedById']) {
			if (!company.result?.fields?.[code]) throw new Error('Missing Companies field ' + code);
		}
	}

	async list(entityTypeId, select, filter = {}) {
		const rows = [];
		let start = 0;
		do {
			const response = await this.call('crm.item.list', { entityTypeId, select, filter, start, order: { id: 'ASC' } });
			if (!Array.isArray(response.result?.items)) throw new Error('Invalid Bitrix item list');
			rows.push(...response.result.items);
			if (response.next == null) break;
			const next = Number(response.next);
			if (!Number.isSafeInteger(next) || next <= start) throw new Error('Invalid Bitrix pagination');
			start = next;
		} while (true);
		return rows;
	}

	companies() {
		return this.list(176, ['id', CLIENT_ID, TAX_ID, 'assignedById']);
	}

	cards(filter) {
		return this.list(this.config.entityTypeId, this.select, filter);
	}

	async find(xmlId) {
		const rows = await this.cards({ '=xmlId': xmlId });
		if (rows.length > 1 || (rows.length && rows[0].xmlId !== xmlId)) throw new Error('Ambiguous Bitrix xmlId');
		return rows[0];
	}

	async save(id, fields) {
		const entityTypeId = this.config.entityTypeId;
		const method = id ? 'crm.item.update' : 'crm.item.add';
		const response = await this.call(method, id ? { entityTypeId, id, fields } : { entityTypeId, fields });
		if (!response.result?.item?.id) throw new Error(method + ' returned no item ID');
		return response.result.item;
	}

	link(id) {
		if (this.config.linkMode === 'crm') return String(id);
		return this.bitrix.PortalUrl + '/crm/type/' + this.config.entityTypeId + '/details/' + id + '/';
	}
}
