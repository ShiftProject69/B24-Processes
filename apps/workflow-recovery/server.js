import http from 'node:http';

function SendJson(oResponse, nStatusCode, oPayload) {
	const sBody = JSON.stringify(oPayload);
	oResponse.writeHead(nStatusCode, {
		'Content-Type': 'application/json',
		'Content-Length': Buffer.byteLength(sBody)
	});
	oResponse.end(sBody);
}

function CreateServer() {
	return http.createServer((oRequest, oResponse) => {
		if (oRequest.method === 'GET' && oRequest.url === '/health') {
			SendJson(oResponse, 200, { ok: true });
			return;
		}

		SendJson(oResponse, 404, { error: 'Not found' });
	});
}

export { CreateServer };
