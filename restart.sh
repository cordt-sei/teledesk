#!/bin/bash
# More gently kill processes
echo "Stopping existing processes..."
pkill -f "node.*bot.js"
pkill -f "node.*slack-webhook.js"

# Wait for processes to terminate
echo "Waiting for processes to stop..."
sleep 5

# Start the webhook server
echo "Starting Slack webhook server..."
NODE_ENV=development PORT=3030 node slack-webhook.js &

# Short pause
sleep 2

# Start the bot with our fixed version
echo "Starting Telegram bot..."
NODE_ENV=development node bot.js &

echo "Services started. Press Ctrl+C to stop."
wait