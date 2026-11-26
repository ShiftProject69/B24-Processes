import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export function loadBitrixConfig() {
	const path = fileURLToPath(new URL('../.env', import.meta.url));
	dotenv.config({ path });

	return {
		portalUrl: process.env.BITRIX_PORTAL_URL,
		userId: process.env.BITRIX_USER_ID || '1',
		token: process.env.BITRIX_TOKEN
	};
}
