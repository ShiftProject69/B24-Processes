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
		return this.Cron.schedule('0 8,18 * * *', async () => {
			console.log('Перезапуск зависших бизнес-процессов в Bitrix24...');
			try {
				const report = await this.Bitrix.RestartStuckBizprocWorkflows({
					dryRun: false,
					stuckMinutes: this.StuckMinutes
				});
				console.log('Итог перезапуска БП', {
					найдено: report.total, пропущено: report.skipped.length, остановлено: report.terminated.length,
					запущено: report.started.length, обнаруженоПослеСверки: report.observed.length, ошибок: report.errors.length
				});
				if (report.errors.length) console.error('Частичный сбой перезапуска БП', report.errors);
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
