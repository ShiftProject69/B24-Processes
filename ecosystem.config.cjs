module.exports = {
	apps: [
		{
			name: 'b24-processes',
			script: 'apps/workflow-recovery/index.js',
			cwd: __dirname,
			out_file: '/dev/null',
			error_file: '/dev/null',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			max_restarts: 10,
			max_memory_restart: '256M',
			env: {
				NODE_ENV: 'production'
			}
		},
		{
			name: 'fakturownia-sync',
			script: 'apps/fakturownia-sync/index.js',
			cwd: __dirname,
			out_file: '/dev/null',
			error_file: '/dev/null',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			stop_exit_codes: [78],
			env: { NODE_ENV: 'production' }
		}
	]
};
