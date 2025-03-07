#!/bin/bash

# Kill any existing bot instances
echo "Stopping any existing bot processes..."
pm2 stop telegram-bot slack-webhook 2>/dev/null || true
pm2 delete telegram-bot slack-webhook 2>/dev/null || true

# Also try to kill any stray node processes running the bot
echo "Killing any stray node processes..."
pkill -f "node.*bot.js" || true

# Clear webhook
echo "Clearing Telegram webhook..."
node clear-webhook.js

# Wait a moment
echo "Waiting for processes to fully terminate..."
sleep 5

# Start with PM2
echo "Starting services with PM2..."
pm2 start ecosystem.config.cjs

# Display running processes
echo "PM2 processes now running:"
pm2 list