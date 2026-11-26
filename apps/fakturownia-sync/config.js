import { registryConfig } from './registry-config.js';

export const FIELD_TYPES = {
	company: 'crm', kind: 'enumeration', buyer: 'string', nip: 'string', issued: 'date', due: 'date',
	status: 'enumeration', overdue: 'boolean', gross: 'money', paid: 'money',
	balance: 'money', pdfUrl: 'url', bases: 'crm', derived: 'crm'
};

function required(env, name) {
	const value = env['FAKTUROWNIA_' + name]?.trim();
	if (!value) throw new Error('Set FAKTUROWNIA_' + name);
	return value;
}

export function syncConfig(env = process.env) {
	const address = required(env, 'ACCOUNT').toLowerCase();
	const match = /^(?:https:\/\/)?([a-z0-9]+(?:-[a-z0-9]+)*)\.fakturownia\.pl\/?$/.exec(address);
	const account = match ? match[1] : address;
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(account)) throw new Error('Invalid FAKTUROWNIA_ACCOUNT');
	const token = required(env, 'TOKEN');
	return { ...registryConfig, account, token };
}
