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
      kill_timeout: 3000,
      wait_ready: true, 
      listen_timeout: 10000,
      max_restarts: 10,
      restart_delay: 5000,
      pre_start: "node clear-webhook.js"
    },
    {
      name: 'slack-webhook',
      script: 'slack-webhook.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT: 3030
      },
      dependency: ['telegram-bot']
    }
  ]
};