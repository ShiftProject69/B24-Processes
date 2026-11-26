import { companyMatcher, invoiceDate, invoiceFields, changes } from './invoice.js';
import { documentId } from './source.js';

export const TIMEZONE = 'Europe/Warsaw';
const localDate = new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE, dateStyle: 'short' });

function sameLinks(current, wanted) {
	const sorted = (values = []) => [...values].map(String).sort();
	return JSON.stringify(sorted(current ?? [])) === JSON.stringify(sorted(wanted));
}

export class InvoiceSync {
	constructor(source, registry, config) {
		this.source = source;
		this.registry = registry;
		this.config = config;
	}

	async upsert(card, xmlId, fields) {
		const patch = card ? changes(card, fields, this.config.fields) : { ...fields, xmlId };
		if (!Object.keys(patch).length) return { card, action: 'unchanged' };
		let saved;
		if (card) {
			saved = await this.registry.save(card.id, patch);
		} else {
			try {
				saved = await this.registry.save(null, patch);
			} catch (error) {
				saved = await this.registry.find(xmlId);
				if (!saved) throw error;
				// Reconcile a lost add response without issuing a second add.
				const pending = changes(saved, fields, this.config.fields);
				if (Object.keys(pending).length) saved = await this.registry.save(saved.id, pending);
			}
		}
		return { card: { ...card, ...saved }, action: card ? 'updated' : 'created' };
	}

	async writeLinks(documents, olderIds, cards, changed, created, report, selected) {
		// Resolve all sources first so a failed page cannot erase valid links.
		const byProforma = new Map();
		for (const [id, invoice] of documents) {
			if (invoice.kind !== 'vat') continue;
			let sourceIds;
			if (Object.hasOwn(invoice, 'from_invoice_id')) {
				const source = invoice.from_invoice_id;
				sourceIds = source == null || source === '' ? [] : [documentId(source)];
			} else {
				sourceIds = [];
				for await (const source of this.source.invoices({ invoice_id: id })) {
					const sourceId = documentId(source.id);
					sourceIds.push(sourceId);
					if (source.issue_date && invoiceDate(source.issue_date) < this.config.firstIssueDate) {
						olderIds.add(sourceId);
					}
				}
			}
			if (sourceIds.length > 1 && selected.has(id)) {
				report.linkReview.push({ invoiceId: id, sourceIds, reason: 'multiple_sources' });
			}
			for (const sourceId of sourceIds) {
				if (olderIds.has(sourceId)) continue;
				const source = documents.get(sourceId);
				if (!source) {
					if (selected.has(id)) report.linkReview.push({ invoiceId: id, sourceId, reason: 'unresolved_source' });
					continue;
				}
				if (source.kind !== 'proforma') continue;
				if (!byProforma.has(sourceId)) byProforma.set(sourceId, []);
				byProforma.get(sourceId).push({ id, singleSource: sourceIds.length === 1 });
			}
		}
		const vatLinks = new Map();
		for (const [sourceId, candidates] of byProforma) {
			if (!candidates.some(candidate => selected.has(candidate.id))) continue;
			const source = documents.get(sourceId);
			const card = cards.get(sourceId);
			let reason;
			if (candidates.length > 1) reason = 'multiple_vat';
			else if (!card) reason = 'missing_proforma_card';
			else if ([true, 'true', 1, '1'].includes(source.cancelled) ||
				['rejected', 'cancelled'].includes(source.status)) reason = 'inactive_proforma';
			if (reason) {
				report.linkReview.push({ sourceId, invoiceIds: candidates.map(row => row.id), reason });
			} else if (candidates[0].singleSource) {
				vatLinks.set(candidates[0].id, this.registry.link(card.id));
			}
		}
		const { bases, derived } = this.config.fields;
		for (const id of selected.keys()) {
			const card = cards.get(id);
			if (!card) continue;
			const links = vatLinks.has(id) ? [vatLinks.get(id)] : [];
			const patch = {};
			if (!sameLinks(card[bases], links)) patch[bases] = links;
			if (!sameLinks(card[derived], [])) patch[derived] = [];
			if (!Object.keys(patch).length) continue;
			try {
				const saved = await this.registry.save(card.id, patch);
				if (Object.entries(patch).some(([field, values]) => !sameLinks(saved[field], values))) {
					throw new Error('Bitrix did not confirm document links');
				}
				if (!created.has(id)) changed.add(id);
			} catch (error) {
				report.errors.push({ stage: 'links', id, message: error.message });
			}
		}
	}

	async run(now = new Date(), { limit } = {}) {
		if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) throw new Error('Invalid sync limit');
		const prefix = 'fakturownia:' + this.config.account + ':';
		const today = localDate.format(now);
		const created = new Set();
		const changed = new Set();
		const report = { startedAt: now.toISOString(), created: 0, updated: 0, unlinked: 0, missing: [], linkReview: [], errors: [] };
		let stage = 'source';
		try {
			const documents = new Map();
			const sourceIds = new Set();
			const olderIds = new Set();
			// Keep historical IDs for cross-period links even when limiting writes.
			for await (const invoice of this.source.invoices()) {
				const id = documentId(invoice.id);
				sourceIds.add(id);
				try {
					const issued = invoiceDate(invoice.issue_date);
					if (!issued) throw new Error('Missing invoice issue date');
					if (issued < this.config.firstIssueDate) olderIds.add(id);
					else if (Object.hasOwn(this.config.kinds, invoice.kind)) documents.set(id, invoice);
				} catch (error) {
					if (Object.hasOwn(this.config.kinds, invoice.kind)) {
						report.errors.push({ stage, id, message: error.message });
					}
				}
			}
			let selected = documents;
			if (limit) {
				const sorted = [...documents].sort(([aId, a], [bId, b]) =>
					a.issue_date.localeCompare(b.issue_date) || aId.length - bId.length || aId.localeCompare(bId));
				selected = new Map(sorted.slice(0, limit));
				report.selected = [...selected.keys()];
			}
			stage = 'registry';
			await this.registry.checkSchema();
			const match = companyMatcher(await this.registry.companies());
			const cards = new Map();
			for (const card of await this.registry.cards()) {
				if (!card.xmlId?.startsWith(prefix)) continue;
				const id = card.xmlId.slice(prefix.length);
				if (cards.has(id)) throw new Error('Duplicate registry key ' + card.xmlId);
				cards.set(id, card);
				const issued = String(card[this.config.fields.issued] ?? '').slice(0, 10);
				if (!limit && !sourceIds.has(id) && (!issued || issued >= this.config.firstIssueDate)) report.missing.push(id);
			}
			stage = 'documents';
			for (const [id, invoice] of selected) {
				try {
					const company = match(invoice);
					const fields = invoiceFields(invoice, company, today, this.config);
					const pdfUrl = await this.source.pdfUrl(invoice);
					fields[this.config.fields.pdfUrl] = pdfUrl;
					if (!pdfUrl) report.errors.push({ stage: 'pdf_link', id, message: 'No document sharing token' });
					const xmlId = prefix + id;
					const card = cards.get(id) ?? await this.registry.find(xmlId);
					const result = await this.upsert(card, xmlId, fields);
					cards.set(id, result.card);
					if (!company) report.unlinked++;
					if (result.action === 'created') created.add(id);
					if (result.action === 'updated') changed.add(id);
				} catch (error) {
					report.errors.push({ stage, id, message: error.message });
				}
			}
			stage = 'links';
			await this.writeLinks(documents, olderIds, cards, changed, created, report, selected);
		} catch (error) {
			report.errors.push({ stage, message: error.message });
		}
		report.created = created.size;
		report.updated = changed.size;
		report.errorCount = report.errors.length;
		report.result = report.errorCount ? 'incomplete' : (report.missing.length || report.linkReview.length) ? 'review' : 'ok';
		report.finishedAt = new Date().toISOString();
		return report;
	}
}
