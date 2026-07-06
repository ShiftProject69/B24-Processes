module.exports = {
	apps: [
		{
			name: 'b24-processes',
			script: 'src/index.js',
			cwd: __dirname,
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			max_restarts: 10,
			max_memory_restart: '256M',
			env: {
				NODE_ENV: 'production'
			}
		}
	]
};
