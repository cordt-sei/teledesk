#!/bin/bash
# startup.sh - Enhanced bot startup script

# Display banner
echo "====================================="
echo "   Starting SEI Helpdesk Bot         "
echo "====================================="

# Kill any existing bot instances
echo "Stopping any existing bot processes..."
pm2 stop telegram-bot slack-webhook 2>/dev/null || true
pm2 delete telegram-bot slack-webhook 2>/dev/null || true

# Check if port 3030 is in use and kill those processes
echo "Checking for processes using port 3030..."
if command -v lsof >/dev/null 2>&1; then
  PORT_PIDS=$(lsof -i :3030 -t 2>/dev/null)
  if [ -n "$PORT_PIDS" ]; then
    echo "Found processes using port 3030. Killing them..."
    for PID in $PORT_PIDS; do
      echo "Killing process $PID"
      kill -9 $PID 2>/dev/null || true
    done
  fi
fi

# Also try to kill any stray node processes running the bot
echo "Checking for stray processes..."
pkill -f "node.*bot.js" || true
pkill -f "node.*slack-webhook.js" || true

# Clear webhook
echo "Clearing Telegram webhook..."
node clear-webhook.js

# Wait a moment
echo "Waiting for processes to terminate..."
sleep 3

# Validate configuration
echo "Validating configuration..."
node tests/validate-config.js

# Check if validation was successful
if [ $? -ne 0 ]; then
  echo "Configuration validation had warnings. Check the output above."
  read -p "Continue anyway? (y/n): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Startup aborted. Please fix configuration issues."
    exit 1
  fi
fi

# Start with PM2
echo "Starting services with PM2..."
pm2 start ecosystem.config.cjs

# Display running processes
echo "PM2 processes now running:"
pm2 list

echo "SEI Helpdesk Bot is now operational!"
echo "====================================="