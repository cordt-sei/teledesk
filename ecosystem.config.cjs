// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'telegram-bot',
      script: 'bot.js',
      instances: 1,
      autorestart: false,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        BOT_PROCESS: 'true'
      },
      exec_mode: 'fork',
      kill_timeout: 3000,
      wait_ready: true, 
      listen_timeout: 10000,
      max_restarts: 10,
      restart_delay: 5000,
      pre_start: "node clear-webhook.js"
    },
    {
      name: 'slack-webhook',
      script: 'modules/slackWebhook.js', 
      instances: 1,
      autorestart: false,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT: 3030,
        WEBHOOK_PROCESS: 'true'
      },
      dependency: ['telegram-bot']
    }
  ]
};