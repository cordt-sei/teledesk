// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'telegram-bot',
      script: 'bot.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        BOT_PROCESS: 'true'
      },
      exec_mode: 'fork',
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 15000,
      max_restarts: 10,
      restart_delay: 5000,
      pre_start: "node clear-webhook.js",
      stop_exit_codes: [0, 1],
      exp_backoff_restart_delay: 100
    },
    {
      name: 'slack-webhook',
      script: 'modules/slackWebhook.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT: 3030,
        WEBHOOK_PROCESS: 'true'
      },
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 15000,
      dependency: ['telegram-bot']
    }
  ]
};