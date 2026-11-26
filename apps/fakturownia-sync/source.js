import { setTimeout as delay } from 'node:timers/promises';

export function documentId(value) {
	if (!/^[1-9]\d*$/.test(String(value))) throw new Error('Invalid Fakturownia document ID');
	return String(value);
}

export class Fakturownia {
	constructor({ account, token }, fetchClient = fetch, wait = delay) {
		this.base = 'https://' + account + '.fakturownia.pl/';
		this.token = token;
		this.fetchClient = fetchClient;
		this.wait = wait;
	}

	async get(path, query = {}) {
		const url = new URL(path, this.base);
		url.search = new URLSearchParams(query);
		for (let attempt = 0; ; attempt++) {
			const response = await this.fetchClient(url, {
				headers: { Authorization: 'Bearer ' + this.token },
				signal: AbortSignal.timeout(60000)
			});
			if (response.ok) return response;
			await response.body?.cancel();
			if (response.status !== 429 || attempt >= 2) {
				throw new Error('Fakturownia GET ' + path + ' HTTP ' + response.status);
			}
			const retry = response.headers.get('Retry-After');
			const delayMs = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
			if (delayMs > 300000) throw new Error('Fakturownia rate limit exceeds five minutes');
			await this.wait(Math.max(1000 * (attempt + 1), delayMs || 0));
		}
	}

	async *invoices(filter = {}) {
		const seen = new Set();
		for (let page = 1; ; page++) {
			const response = await this.get('invoices.json', {
				period: 'all', income: 'yes', per_page: 100, page, ...filter
			});
			let rows;
			try {
				rows = await response.json();
			} catch {
				throw new Error('Invalid JSON in Fakturownia list');
			}
			if (!Array.isArray(rows)) throw new Error('Invalid Fakturownia list');
			for (const row of rows) {
				const id = documentId(row.id);
				if (seen.has(id)) throw new Error('Fakturownia pagination repeated document ' + id);
				seen.add(id);
				if ([false, 'false', 0, '0', 'no'].includes(row.income)) continue;
				yield row;
			}
			if (rows.length < 100) return;
		}
	}

	async pdfUrl(invoice) {
		let token = invoice.token;
		if (!token) {
			const id = documentId(invoice.id);
			const response = await this.get('invoices/' + id + '.json');
			let detail;
			try {
				detail = await response.json();
			} catch {
				throw new Error('Invalid invoice JSON');
			}
			if (documentId(detail?.id) !== id) throw new Error('Unexpected invoice in detail response');
			token = detail.token;
		}
		if (!token) return '';
		if (typeof token !== 'string' || token === this.token || !/^[A-Za-z0-9_-]+$/.test(token)) {
			throw new Error('Invalid document sharing token');
		}
		return this.base + 'invoice/' + token + '.pdf';
	}
}
