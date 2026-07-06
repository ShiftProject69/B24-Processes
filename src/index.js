import dotenv from 'dotenv';
import BitrixProcesses from './bitrixProcesses.js';
import Cron from './cron.js';
import { CreateServer } from './server.js';

dotenv.config();

const oBitrix = new BitrixProcesses({
	portalUrl: process.env.BITRIX_PORTAL_URL,
	userId: process.env.BITRIX_USER_ID || '1',
	token: process.env.BITRIX_TOKEN
});

const nPort = Number(process.env.PORT || 3000);
if (!Number.isInteger(nPort) || nPort <= 0) {
	throw new Error('PORT must be a positive integer');
}

const oCron = new Cron({
	Bitrix: oBitrix,
	stuckMinutes: Number(process.env.BITRIX_STUCK_MINUTES || 5)
});
oCron.ScheduleAll();

const oServer = CreateServer();
oServer.listen(nPort, () => {
	console.log(`B24 Processes server is listening on port ${nPort}`);
	console.log('Cron jobs scheduled in Europe/Warsaw timezone');
});
