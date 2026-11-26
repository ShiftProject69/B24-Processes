import BitrixClient from '../../shared/bitrix/client.js';
import { loadBitrixConfig } from '../../shared/config.js';
import { syncConfig } from './config.js';
import { Registry } from './registry.js';
import { Fakturownia } from './source.js';
import { InvoiceSync } from './sync.js';
import { scheduleSync } from './schedule.js';

try {
	const bitrix = new BitrixClient(loadBitrixConfig());
	const config = syncConfig();
	const sync = new InvoiceSync(new Fakturownia(config), new Registry(bitrix, config), config);
	scheduleSync(sync);
	console.log('fakturownia-sync scheduled at 09:00 and 14:00 Europe/Warsaw');
} catch (error) {
	console.error(error.message);
	process.exitCode = 78;
}
