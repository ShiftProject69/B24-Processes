export const CLIENT_ID = 'ufCrm5_1789194365934';
export const TAX_ID = 'ufCrm5_1637084395476';

function nip(value) {
	return String(value ?? '').trim().toUpperCase().replace(/[\s.-]/g, '');
}

export function companyMatcher(companies) {
	const byClient = new Map();
	const byNip = new Map();
	function add(index, key, row) {
		if (!key) return;
		if (!index.has(key)) index.set(key, []);
		index.get(key).push(row);
	}
	for (const row of companies) {
		add(byClient, String(row[CLIENT_ID] ?? '').trim(), row);
		add(byNip, nip(row[TAX_ID]), row);
	}
	return invoice => {
		const client = String(invoice.client_id ?? '').trim();
		const tax = nip(invoice.buyer_tax_no);
		const matches = byClient.get(client);
		if (matches) {
			const candidateTax = nip(matches[0][TAX_ID]);
			if (matches.length !== 1 || (tax && candidateTax && candidateTax !== tax)) return null;
			return matches[0];
		}
		const candidates = byNip.get(tax);
		if (candidates?.length !== 1) return null;
		const otherId = String(candidates[0][CLIENT_ID] ?? '').trim();
		return client && otherId && otherId !== client ? null : candidates[0];
	};
}

function amount(value) {
	const text = String(value ?? '').trim();
	if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error('Invalid monetary amount');
	return text;
}

// Align decimal places before subtraction so currency precision survives the conversion.
function remaining(gross, paid) {
	const precision = Math.max(...[gross, paid].map(text => text.split('.')[1]?.length ?? 0));
	function units(text) {
		const [whole, fraction = ''] = text.split('.');
		return BigInt(whole + fraction.padEnd(precision, '0'));
	}
	const difference = units(gross) - units(paid);
	if (difference <= 0n) return '0';
	const digits = String(difference).padStart(precision + 1, '0');
	return precision ? digits.slice(0, -precision) + '.' + digits.slice(-precision) : digits;
}

export function invoiceDate(value) {
	if (!value) return '';
	if (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value)) ||
		new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Invalid invoice date');
	return value;
}

export function invoiceFields(invoice, company, today, config) {
	const { fields: f, kinds, statuses } = config;
	const cancelled = [true, 'true', 1, '1'].includes(invoice.cancelled);
	const status = cancelled ? 'cancelled' : invoice.status;
	if (!Object.hasOwn(statuses, status)) throw new Error('Unmapped invoice status');
	if (!invoice.number || !/^[A-Z]{3}$/.test(invoice.currency)) throw new Error('Missing invoice number or currency');
	const gross = amount(invoice.price_gross);
	const missingPaid = invoice.paid == null || invoice.paid === '';
	if (missingPaid && status === 'partial') throw new Error('Missing partial payment amount');
	const paid = amount(missingPaid ? (status === 'paid' ? gross : '0') : invoice.paid);
	const balance = remaining(gross, paid);
	const due = invoiceDate(invoice.payment_to);
	const active = !['paid', 'rejected', 'cancelled'].includes(status);
	const money = value => value + '|' + invoice.currency;
	const fields = {
		title: String(invoice.number), [f.company]: company ? String(company.id) : '',
		[f.kind]: kinds[invoice.kind], [f.buyer]: invoice.buyer_name ?? '', [f.nip]: invoice.buyer_tax_no ?? '',
		[f.issued]: invoiceDate(invoice.issue_date), [f.due]: due, [f.status]: statuses[status],
		[f.overdue]: active && due && due < today && balance !== '0' ? 1 : 0,
		[f.gross]: money(gross), [f.paid]: money(paid), [f.balance]: money(balance)
	};
	const assignee = Number(company?.assignedById);
	if (Number.isSafeInteger(assignee) && assignee > 0) fields.assignedById = assignee;
	return fields;
}

export function changes(card, fields, f) {
	const result = {};
	for (const [key, value] of Object.entries(fields)) {
		let current = card[key] ?? '';
		if (key === f.syncedAt && Date.parse(current) === Date.parse(value)) continue;
		if (key === f.issued || key === f.due) current = String(current).slice(0, 10);
		if (key === f.overdue) current = ['1', 1, 'Y', true].includes(current) ? 1 : 0;
		if (key === f.company && [0, '0', false].includes(current)) current = '';
		if ([f.gross, f.paid, f.balance].includes(key)) {
			const [number, currency] = String(current).split('|');
			const [desired, desiredCurrency] = value.split('|');
			const canonical = n => n.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
			if (currency === desiredCurrency && canonical(number) === canonical(desired)) continue;
		}
		if (String(current) !== String(value)) result[key] = value;
	}
	return result;
}
