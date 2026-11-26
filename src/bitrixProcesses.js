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
		fetchClient = fetch
	}) {
		if (!portalUrl || !userId || !token) {
			throw new Error('Bitrix portalUrl, userId and token are required');
		}

		this.PortalUrl = portalUrl.replace(/\/+$/, '');
		this.UserId = userId;
		this.Token = token;
		this.FetchClient = fetchClient;
	}

	GetMethodUrl(sMethod) {
		return `${this.PortalUrl}/rest/${this.UserId}/${this.Token}/${sMethod}`;
	}

	async DoRequest(sMethod, oPayload = {}) {
		const oResponse = await this.FetchClient(this.GetMethodUrl(sMethod), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(oPayload)
		});

		const oData = await oResponse.json();
		if (!oResponse.ok || oData.error) {
			throw new Error(oData.error_description || oData.error || `Bitrix request failed: ${oResponse.status}`);
		}

		return oData;
	}

	GetBizprocLockedBefore(oOptions = {}) {
		if (oOptions.lockedBefore) {
			return oOptions.lockedBefore;
		}

		const nStuckMinutes = Number(oOptions.stuckMinutes ?? 5);
		const oNow = oOptions.now ? new Date(oOptions.now) : new Date();

		if (!Number.isFinite(nStuckMinutes) || Number.isNaN(oNow.getTime())) {
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

		return [];
	}

	async GetStuckBizprocWorkflows(oOptions = {}) {
		const sLockedBefore = this.GetBizprocLockedBefore(oOptions);
		const oFilter = {
			...(oOptions.filter || {}),
			'<OWNED_UNTIL': sLockedBefore
		};
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

	async TerminateBizprocWorkflow(sWorkflowId) {
		if (!sWorkflowId) {
			return false;
		}

		const oResponse = await this.DoRequest('bizproc.workflow.terminate', {
			ID: sWorkflowId
		});

		return oResponse.result ?? true;
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

		return oResponse.result ?? true;
	}

	async RestartStuckBizprocWorkflows(oOptions = {}) {
		const bDryRun = oOptions.dryRun !== false;
		const oFilter = { ...(oOptions.filter || {}) };
		const sLockedBefore = this.GetBizprocLockedBefore(oOptions);

		const aWorkflows = await this.GetStuckBizprocWorkflows({
			...oOptions,
			lockedBefore: sLockedBefore,
			filter: oFilter
		});

		const oReport = {
			dryRun: bDryRun,
			lockedBefore: sLockedBefore,
			total: aWorkflows.length,
			planned: [],
			skipped: [],
			terminated: [],
			started: [],
			errors: []
		};

		for (const oWorkflow of aWorkflows) {
			const oInfo = this.GetBizprocWorkflowInfo(oWorkflow);

			if (!oInfo.workflowId) {
				oReport.skipped.push({
					workflowId: null,
					crmUrl: oInfo.crmUrl,
					reason: 'Missing ID'
				});
				continue;
			}

			if (!oInfo.templateId) {
				oReport.skipped.push({
					workflowId: oInfo.workflowId,
					crmUrl: oInfo.crmUrl,
					reason: 'Missing TEMPLATE_ID'
				});
				continue;
			}

			if (!oInfo.documentId) {
				oReport.skipped.push({
					workflowId: oInfo.workflowId,
					crmUrl: null,
					reason: 'Missing DOCUMENT_ID'
				});
				continue;
			}

			oReport.planned.push(oInfo);

			if (bDryRun) {
				continue;
			}

			try {
				const mTerminateResult = await this.TerminateBizprocWorkflow(oInfo.workflowId);
				if (mTerminateResult === false) {
					throw new Error('bizproc.workflow.terminate returned false');
				}

				oReport.terminated.push(oInfo.workflowId);

				const mStartedWorkflowId = await this.StartBizprocWorkflow(
					oInfo.templateId,
					oInfo.documentId,
					oOptions.parameters || {}
				);
				if (mStartedWorkflowId === false) {
					throw new Error('bizproc.workflow.start returned false');
				}

				oReport.started.push({
					sourceWorkflowId: oInfo.workflowId,
					workflowId: mStartedWorkflowId,
					templateId: oInfo.templateId,
					documentId: oInfo.documentId,
					crmUrl: oInfo.crmUrl
				});
			}
			catch (err) {
				oReport.errors.push({
					workflowId: oInfo.workflowId,
					crmUrl: oInfo.crmUrl,
					message: err.message
				});
			}
		}

		return oReport;
	}
}

export default BitrixProcesses;
