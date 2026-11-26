import cron from 'node-cron';
import { TIMEZONE } from './sync.js';

export function scheduleSync(sync, scheduler = cron) {
	return scheduler.schedule('0 9,14 * * *', async () => {
		const report = await sync.run();
		console.log(JSON.stringify({ app: 'fakturownia-sync', ...report }));
	}, { timezone: TIMEZONE, noOverlap: true, name: 'fakturownia-sync' });
}
