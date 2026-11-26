const DEFAULT_BIZPROC_SELECT = [
	'ID',
	'MODIFIED',
	'OWNED_UNTIL',
	'MODULE_ID',
	'ENTITY',
	'DOCUMENT_ID',
	'STARTED',
	'STARTED_BY',
	'TEMPLATE_ID'
];

class BitrixProcesses {
	constructor({
		portalUrl,
		userId,
		token,
		fetchClient = fetch,
		wait = ms => new Promise(resolve => setTimeout(resolve, ms))
	}) {
		if (!portalUrl || !userId || !token) {
			throw new Error('Bitrix portalUrl, userId and token are required');
		}

		this.PortalUrl = portalUrl.replace(/\/+$/, '');
		this.UserId = userId;
		this.Token = token;
		this.FetchClient = fetchClient;
		this.Wait = wait;
	}

	GetMethodUrl(sMethod) {
		return `${this.PortalUrl}/rest/${this.UserId}/${this.Token}/${sMethod}`;
	}

	async DoRequest(sMethod, oPayload = {}) {
		const oResponse = await this.FetchClient(this.GetMethodUrl(sMethod), {
			method: 'POST',
			signal: AbortSignal.timeout(60000),
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(oPayload)
		});

		const oData = await oResponse.json();
		if (!oResponse.ok || oData.error) {
			const error = new Error(oData.error_description || oData.error || `Bitrix request failed: ${oResponse.status}`);
			error.code = oData.error;
			error.status = oResponse.status;
			throw error;
		}

		return oData;
	}

	GetBizprocLockedBefore(oOptions = {}) {
		if (oOptions.lockedBefore) {
			return oOptions.lockedBefore;
		}

		const nStuckMinutes = Number(oOptions.stuckMinutes ?? 5);
		const oNow = oOptions.now ? new Date(oOptions.now) : new Date();

		if (!Number.isFinite(nStuckMinutes) || nStuckMinutes < 0 || Number.isNaN(oNow.getTime())) {
			throw new Error('Invalid stuck workflow time options');
		}

		return new Date(oNow.getTime() - nStuckMinutes * 60 * 1000).toISOString();
	}

	GetBizprocWorkflowField(oWorkflow, aFieldNames) {
		if (!oWorkflow) {
			return null;
		}

		for (const sFieldName of aFieldNames) {
			if (oWorkflow[sFieldName] !== undefined && oWorkflow[sFieldName] !== null) {
				return oWorkflow[sFieldName];
			}

			const sLowerFieldName = sFieldName.toLowerCase();
			if (oWorkflow[sLowerFieldName] !== undefined && oWorkflow[sLowerFieldName] !== null) {
				return oWorkflow[sLowerFieldName];
			}
		}

		return null;
	}

	GetBizprocWorkflowDocumentId(oWorkflow) {
		const oDocumentId = this.GetBizprocWorkflowField(oWorkflow, ['DOCUMENT_ID']);
		if (Array.isArray(oDocumentId)) {
			return oDocumentId;
		}

		const sModuleId = this.GetBizprocWorkflowField(oWorkflow, ['MODULE_ID']);
		const sEntity = this.GetBizprocWorkflowField(oWorkflow, ['ENTITY']);
		if (sModuleId && sEntity && oDocumentId) {
			return [sModuleId, sEntity, oDocumentId];
		}

		return null;
	}

	GetCrmUrlFromBizprocWorkflowDocumentId(aDocumentId) {
		if (!Array.isArray(aDocumentId) || aDocumentId.length !== 3) {
			return null;
		}

		const sDocumentId = aDocumentId[2];
		if (!sDocumentId || typeof sDocumentId !== 'string') {
			return null;
		}

		let aMatch = sDocumentId.match(/^DEAL_(\d+)$/);
		if (aMatch) return `${this.PortalUrl}/crm/deal/details/${aMatch[1]}/`;

		aMatch = sDocumentId.match(/^CONTACT_(\d+)$/);
		if (aMatch) return `${this.PortalUrl}/crm/contact/details/${aMatch[1]}/`;

		aMatch = sDocumentId.match(/^COMPANY_(\d+)$/);
		if (aMatch) return `${this.PortalUrl}/crm/company/details/${aMatch[1]}/`;

		aMatch = sDocumentId.match(/^LEAD_(\d+)$/);
		if (aMatch) return `${this.PortalUrl}/crm/lead/details/${aMatch[1]}/`;

		aMatch = sDocumentId.match(/^DYNAMIC_(\d+)_(\d+)$/);
		if (aMatch) return `${this.PortalUrl}/crm/type/${aMatch[1]}/details/${aMatch[2]}/`;

		return null;
	}

	GetBizprocWorkflowInfo(oWorkflow) {
		const aDocumentId = this.GetBizprocWorkflowDocumentId(oWorkflow);

		return {
			workflowId: this.GetBizprocWorkflowField(oWorkflow, ['ID']),
			templateId: this.GetBizprocWorkflowField(oWorkflow, ['TEMPLATE_ID']),
			documentId: aDocumentId,
			crmUrl: this.GetCrmUrlFromBizprocWorkflowDocumentId(aDocumentId)
		};
	}

	GetBizprocWorkflowBatch(oResponse) {
		const oResult = oResponse?.result;
		if (Array.isArray(oResult)) {
			return oResult;
		}

		if (Array.isArray(oResult?.items)) {
			return oResult.items;
		}

		throw new Error('Unexpected workflow list response');
	}

	async GetStuckBizprocWorkflows(oOptions = {}) {
		const sLockedBefore = this.GetBizprocLockedBefore(oOptions);
		const oFilter = {
			...(oOptions.filter || {}),
			'<OWNED_UNTIL': sLockedBefore
		};
		return this.ListWorkflows(oFilter, oOptions);
	}

	async ListWorkflows(oFilter, oOptions = {}) {
		const oPayload = {
			SELECT: oOptions.select || DEFAULT_BIZPROC_SELECT,
			FILTER: oFilter,
			ORDER: oOptions.order || { OWNED_UNTIL: 'asc' }
		};

		let nStart = oOptions.start || 0;
		let aWorkflows = [];

		while (nStart !== undefined && nStart !== null) {
			const oResponse = await this.DoRequest('bizproc.workflow.instances', {
				...oPayload,
				start: nStart
			});

			aWorkflows = aWorkflows.concat(this.GetBizprocWorkflowBatch(oResponse));
			nStart = oResponse.next;
		}

		return aWorkflows;
	}

	async TerminateBizprocWorkflow(sWorkflowId, status) {
		if (!sWorkflowId) {
			return false;
		}

		const oResponse = await this.DoRequest('bizproc.workflow.terminate', {
			ID: sWorkflowId,
			STATUS: status
		});

		return oResponse.result;
	}

	async StartBizprocWorkflow(mTemplateId, aDocumentId, oParameters = {}) {
		if (!mTemplateId || !Array.isArray(aDocumentId) || aDocumentId.length !== 3) {
			return false;
		}

		const oResponse = await this.DoRequest('bizproc.workflow.start', {
			TEMPLATE_ID: mTemplateId,
			DOCUMENT_ID: aDocumentId,
			PARAMETERS: oParameters
		});

		return oResponse.result;
	}

	GetLockTime(row) {
		return Date.parse(this.GetBizprocWorkflowField(row, ['OWNED_UNTIL']));
	}

	async TemplateParameters(templateId) {
		const response = await this.DoRequest('bizproc.workflow.template.list', {
			SELECT: ['ID', 'PARAMETERS'], FILTER: { ID: templateId }
		});
		const template = response.result?.find(item => String(item.ID) === String(templateId));
		if (!template || !template.PARAMETERS || typeof template.PARAMETERS !== 'object') {
			throw new Error('Template parameters unavailable');
		}
		return template.PARAMETERS;
	}

	async MatchingIds(info) {
		const [moduleId, entity, document] = info.documentId;
		const rows = await this.ListWorkflows({
			TEMPLATE_ID: info.templateId, MODULE_ID: moduleId, ENTITY: entity, DOCUMENT_ID: document
		});
		return rows.map(row => this.GetBizprocWorkflowInfo(row))
			.filter(item => String(item.templateId) === String(info.templateId)
				&& JSON.stringify(item.documentId) === JSON.stringify(info.documentId))
			.map(item => item.workflowId);
	}

	async StartAndVerify(info, parameters, baseline, report) {
		let failure;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const id = await this.StartBizprocWorkflow(info.templateId, info.documentId, parameters);
				if (typeof id !== 'string' || !id.trim() || id === info.workflowId) {
					throw new Error('Start response missing new ID');
				}
				report.started.push({ ...info, sourceWorkflowId: info.workflowId, workflowId: id });
				return;
			} catch (error) {
				if (error.code === 'QUERY_LIMIT_EXCEEDED' && attempt === 0) {
					await this.Wait(5000);
					continue;
				}
				if (error.code && error.status < 500 && error.code !== 'ERROR_UNEXPECTED_ANSWER') throw error;
				failure = error;
				break;
			}
		}

		for (const delay of [5000, 15000]) {
			await this.Wait(delay);
			try {
				const ids = await this.MatchingIds(info);
				const added = ids.filter(id => id && !baseline.has(id));
				if (added.length) {
					report.observed.push({ ...info, activeIds: added });
					return;
				}
			} catch (error) {
				failure = error;
			}
		}
		throw new Error('Start unconfirmed: ' + failure.message);
	}

	async RestartStuckBizprocWorkflows(options = {}) {
		const dryRun = options.dryRun !== false;
		const lockedBefore = this.GetBizprocLockedBefore(options);
		const candidates = await this.GetStuckBizprocWorkflows({ ...options, lockedBefore });
		const report = {
			dryRun, lockedBefore, total: 0, planned: [], skipped: [],
			terminated: [], started: [], observed: [], errors: []
		};
		const seen = new Set();
		const templates = new Map();
		const parameters = options.parameters || {};

		for (const row of candidates) {
			const info = this.GetBizprocWorkflowInfo(row);
			if (info.workflowId && seen.has(info.workflowId)) continue;
			seen.add(info.workflowId);
			report.total++;
			if (!info.workflowId || !info.templateId || info.documentId?.length !== 3
				|| !info.documentId.every(Boolean)) {
				report.skipped.push({ ...info, reason: 'Missing workflow, template or document ID' });
				continue;
			}
			if (!(this.GetLockTime(row) < Date.parse(lockedBefore))) {
				report.skipped.push({ ...info, reason: 'Missing, invalid or unexpired lock' });
				continue;
			}
			report.planned.push(info);
			if (dryRun) continue;

			let stage = 'preflight';
			try {
				if (!templates.has(info.templateId)) {
					templates.set(info.templateId, this.TemplateParameters(info.templateId));
				}
				const definitions = await templates.get(info.templateId);
				const missing = Object.entries(definitions).find(([name, definition]) =>
					['Y', true, 1, '1'].includes(definition.Required ?? definition.REQUIRED)
					&& (parameters[name] == null || parameters[name] === ''));
				if (missing) throw new Error('Missing required parameter: ' + missing[0]);

				const baseline = new Set(await this.MatchingIds(info));
				const byId = { ID: info.workflowId };
				const current = (await this.ListWorkflows(byId)).find(item =>
					this.GetBizprocWorkflowField(item, ['ID']) === info.workflowId);
				const lock = this.GetLockTime(current);
				if (!(lock < Date.parse(this.GetBizprocLockedBefore(options)))) {
					report.skipped.push({ ...info, reason: 'Workflow disappeared or lock no longer stale' });
					continue;
				}

				stage = 'terminate';
				const status = 'Автоматическая остановка для восстановления. Блокировка истекла '
					+ new Date(lock).toISOString() + ', порог просрочки ' + (options.stuckMinutes ?? 5) + ' мин.';
				if (await this.TerminateBizprocWorkflow(info.workflowId, status) !== true) {
					throw new Error('Termination not confirmed');
				}
				report.terminated.push(info.workflowId);
				if ((await this.ListWorkflows(byId)).length) throw new Error('Old workflow still active');

				stage = 'start';
				await this.StartAndVerify(info, parameters, baseline, report);
			} catch (error) {
				report.errors.push({ ...info, stage, message: error.message });
			}
		}
		return report;
	}
}

export default BitrixProcesses;
