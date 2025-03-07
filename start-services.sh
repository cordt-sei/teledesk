#!/bin/bash
# Kill any existing processes
pkill -f "node.*bot.js"
pkill -f "node.*slack-webhook.js"

# Set port explicitly
export PORT=3030
export NODE_ENV=development

# Start both services
node bot.js &
node slack-webhook.js &

echo "Services started. Press Ctrl+C to stop."
wait
