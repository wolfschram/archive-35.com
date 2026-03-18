/**
 * pm2 Ecosystem Configuration
 * Run: pm2 start ecosystem.config.js
 */
module.exports = {
  apps: [
    {
      name: 'job-pipeline-server',
      script: 'server.js',
      cwd: __dirname,
      env: {
        PORT: 3000,
        NODE_ENV: 'production',
      },
      watch: false,
      max_restarts: 10,
      restart_delay: 2000,
    },
    {
      name: 'job-pipeline-conductor',
      script: 'conductor/scheduler.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
