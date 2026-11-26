import { loadBitrixConfig } from '../../shared/config.js';
import BitrixClient from '../../shared/bitrix/client.js';
import BitrixProcesses from './bitrixProcesses.js';
import Cron from './cron.js';
import { CreateServer } from './server.js';

const bitrix = new BitrixClient(loadBitrixConfig());
const recovery = new BitrixProcesses(bitrix);

const nPort = Number(process.env.PORT || 3000);
if (!Number.isInteger(nPort) || nPort <= 0) {
	throw new Error('PORT must be a positive integer');
}

const oCron = new Cron({
	Bitrix: recovery,
	stuckMinutes: Number(process.env.BITRIX_STUCK_MINUTES || 5)
});
oCron.ScheduleAll();

const oServer = CreateServer();
oServer.listen(nPort, () => {
	console.log(`B24 Processes server is listening on port ${nPort}`);
	console.log('Cron jobs scheduled in Europe/Warsaw timezone');
});
