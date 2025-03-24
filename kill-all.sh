#!/bin/bash
# kill-all.sh - Kill all teledesk related processes

echo "Killing all teledesk processes..."

# Kill any PM2 processes
if command -v pm2 >/dev/null 2>&1; then
  echo "Stopping PM2 processes..."
  pm2 stop telegram-bot slack-webhook 2>/dev/null || true
  pm2 delete telegram-bot slack-webhook 2>/dev/null || true
  echo "PM2 processes stopped"
fi

# Kill any Node.js processes running bot.js or slackWebhook.js
echo "Killing Node.js processes..."

# Find and kill bot processes
if command -v pgrep >/dev/null 2>&1; then
  BOT_PIDS=$(pgrep -f "node.*bot.js")
  WEBHOOK_PIDS=$(pgrep -f "node.*slackWebhook.js")
  
  if [ -n "$BOT_PIDS" ]; then
    echo "Killing bot processes: $BOT_PIDS"
    kill -15 $BOT_PIDS 2>/dev/null || true
    sleep 1
    kill -9 $BOT_PIDS 2>/dev/null || true
  fi
  
  if [ -n "$WEBHOOK_PIDS" ]; then
    echo "Killing webhook processes: $WEBHOOK_PIDS"
    kill -15 $WEBHOOK_PIDS 2>/dev/null || true
    sleep 1
    kill -9 $WEBHOOK_PIDS 2>/dev/null || true
  fi
else
  # Fallback if pgrep is not available
  echo "Using fallback method to kill processes"
  pkill -f "node.*bot.js" 2>/dev/null || true
  pkill -f "node.*slackWebhook.js" 2>/dev/null || true
  sleep 1
  pkill -9 -f "node.*bot.js" 2>/dev/null || true
  pkill -9 -f "node.*slackWebhook.js" 2>/dev/null || true
fi

# Check for any remaining processes on port 3030
if command -v lsof >/dev/null 2>&1; then
  PORT_PIDS=$(lsof -i :3030 -t 2>/dev/null)
  if [ -n "$PORT_PIDS" ]; then
    echo "Killing processes on port 3030: $PORT_PIDS"
    kill -15 $PORT_PIDS 2>/dev/null || true
    sleep 1
    kill -9 $PORT_PIDS 2>/dev/null || true
  fi
fi

echo "All teledesk processes killed"
echo "You can now start a fresh instance with 'yarn dev' or './startup.sh'"