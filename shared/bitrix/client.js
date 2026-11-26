export default class BitrixClient {
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
}
