import cron from 'node-cron';

const POLAND_TIMEZONE = 'Europe/Warsaw';

class Cron {
	constructor({
		Bitrix,
		Cron: CronClient = cron,
		stuckMinutes = 5
	}) {
		if (!Bitrix) {
			throw new Error('Bitrix client is required');
		}

		this.Bitrix = Bitrix;
		this.Cron = CronClient;
		this.StuckMinutes = stuckMinutes;
	}

	ScheduleRestartStuckBizprocWorkflows() {
		return this.Cron.schedule('0 4 * * *', async () => {
			console.log('Перезапуск зависших бизнес-процессов в Bitrix24...');
			try {
				await this.Bitrix.RestartStuckBizprocWorkflows({
					dryRun: false,
					stuckMinutes: this.StuckMinutes
				});
				console.log('Перезапуск зависших бизнес-процессов в Bitrix24 выполнен успешно');
			}
			catch (error) {
				console.error('Перезапуск зависших бизнес-процессов в Bitrix24 провалился:', error);
			}
		}, {
			timezone: POLAND_TIMEZONE
		});
	}

	ScheduleAll() {
		return [this.ScheduleRestartStuckBizprocWorkflows()];
	}
}

export default Cron;
