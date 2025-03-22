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