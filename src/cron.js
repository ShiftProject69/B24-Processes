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

	ScheduleExRatesUpdate() {
		return this.Cron.schedule('0 1 * * *', async () => {
			console.log('Обновление Exchange Rates в Bitrix24...');
			try {
				await this.Bitrix.UpdatePlnExchangeRates(new Date());
				console.log('Обновление Exchange Rates в Bitrix24 выполнено успешно');
			}
			catch (error) {
				console.error('Обновление Exchange Rates в Bitrix24 провалилось:', error);
			}
		}, {
			timezone: POLAND_TIMEZONE
		});
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
		return [
			this.ScheduleExRatesUpdate(),
			this.ScheduleRestartStuckBizprocWorkflows()
		];
	}
}

export default Cron;
