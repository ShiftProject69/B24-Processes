import test from 'node:test';
import assert from 'node:assert/strict';

import { CreateServer } from '../src/server.js';

test('CreateServer responds to health checks', async () => {
	const oServer = CreateServer();

	const oResponse = await new Promise((resolve, reject) => {
		oServer.listen(0, '127.0.0.1', async () => {
			try {
				const { port } = oServer.address();
				resolve(await fetch(`http://127.0.0.1:${port}/health`));
			}
			catch (err) {
				reject(err);
			}
		});
	});

	try {
		assert.equal(oResponse.status, 200);
		assert.deepEqual(await oResponse.json(), { ok: true });
	}
	finally {
		await new Promise(resolve => oServer.close(resolve));
	}
});
