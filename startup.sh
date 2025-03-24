#!/bin/bash
# startup.sh - Enhanced bot startup script with better process management

# Display banner
echo "====================================="
echo "   Starting SEI Helpdesk Bot         "
echo "====================================="

# Check for running PM2 processes
echo "Checking for running processes..."
if command -v pm2 &> /dev/null; then
  # Get any existing telegram-bot or slack-webhook processes
  PM2_PROCESSES=$(pm2 jlist 2>/dev/null | grep -E '"name":"(telegram-bot|slack-webhook)"' | wc -l)
  
  if [ "$PM2_PROCESSES" -gt "0" ]; then
    echo "Found $PM2_PROCESSES PM2 processes. Stopping..."
    pm2 stop telegram-bot slack-webhook 2>/dev/null || true
    pm2 delete telegram-bot slack-webhook 2>/dev/null || true
    echo "Waiting for processes to terminate..."
    sleep 3
  else
    echo "No PM2 processes found."
  fi
else
  echo "PM2 not found. Skipping PM2 process check."
fi

# Function to check if port is in use and kill process
kill_process_on_port() {
  local port=$1
  
  # Check if port is in use
  if command -v lsof >/dev/null 2>&1; then
    PORT_PIDS=$(lsof -i :$port -t 2>/dev/null)
    if [ -n "$PORT_PIDS" ]; then
      echo "Found processes using port $port:"
      
      for PID in $PORT_PIDS; do
        PROCESS_INFO=$(ps -p $PID -o pid,cmd | grep -v PID)
        echo "  PID: $PID - $PROCESS_INFO"
        
        echo "Killing process $PID"
        kill -15 $PID 2>/dev/null
      done
      
      # Wait briefly for processes to terminate gracefully
      sleep 2
      
      # Check if any processes are still running and force kill
      REMAINING_PIDS=$(lsof -i :$port -t 2>/dev/null)
      if [ -n "$REMAINING_PIDS" ]; then
        echo "Some processes did not terminate gracefully. Force killing..."
        for PID in $REMAINING_PIDS; do
          echo "Force killing process $PID"
          kill -9 $PID 2>/dev/null || true
        done
      fi
    else
      echo "No processes found using port $port."
    fi
  else
    echo "lsof command not found. Skipping port check."
  fi
}

# Check for processes using the webhook port
echo "Checking for processes using port 3030..."
kill_process_on_port 3030

# Also try to kill any stray node processes running the bot
echo "Checking for stray Node.js processes..."
if command -v pgrep >/dev/null 2>&1; then
  # Find any node processes running our files
  BOT_PIDS=$(pgrep -f "node.*bot.js")
  WEBHOOK_PIDS=$(pgrep -f "node.*slackWebhook.js")
  
  if [ -n "$BOT_PIDS" ]; then
    echo "Found stray bot processes: $BOT_PIDS"
    for PID in $BOT_PIDS; do
      echo "Killing bot process $PID"
      kill -15 $PID 2>/dev/null
    done
  fi
  
  if [ -n "$WEBHOOK_PIDS" ]; then
    echo "Found stray webhook processes: $WEBHOOK_PIDS"
    for PID in $WEBHOOK_PIDS; do
      echo "Killing webhook process $PID"
      kill -15 $PID 2>/dev/null
    done
  fi
  
  # Wait briefly and force kill if necessary
  if [ -n "$BOT_PIDS" ] || [ -n "$WEBHOOK_PIDS" ]; then
    echo "Waiting for processes to terminate..."
    sleep 2
    
    # Force kill any remaining processes
    REMAINING_BOT_PIDS=$(pgrep -f "node.*bot.js")
    REMAINING_WEBHOOK_PIDS=$(pgrep -f "node.*slackWebhook.js")
    
    if [ -n "$REMAINING_BOT_PIDS" ]; then
      echo "Force killing remaining bot processes..."
      for PID in $REMAINING_BOT_PIDS; do
        kill -9 $PID 2>/dev/null || true
      done
    fi
    
    if [ -n "$REMAINING_WEBHOOK_PIDS" ]; then
      echo "Force killing remaining webhook processes..."
      for PID in $REMAINING_WEBHOOK_PIDS; do
        kill -9 $PID 2>/dev/null || true
      done
    fi
  fi
else
  echo "pgrep command not found. Using alternative approach..."
  pkill -f "node.*bot.js" 2>/dev/null || true
  pkill -f "node.*slackWebhook.js" 2>/dev/null || true
fi

# Clear webhook
echo "Clearing Telegram webhook..."
node clear-webhook.js

# Wait a moment
echo "Waiting for processes to terminate completely..."
sleep 3

# Ensure data directory exists
echo "Checking data directory..."
mkdir -p data
chmod 755 data

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

# Wait a moment for processes to start
sleep 3

# Check if processes started successfully
PM2_STATUS=$(pm2 jlist)
if echo "$PM2_STATUS" | grep -q "errored"; then
  echo "WARNING: Some processes may have errored. Check PM2 logs:"
  pm2 logs --lines 10
else
  # Display running processes
  echo "PM2 processes now running:"
  pm2 list
fi

echo "SEI Helpdesk Bot is now operational!"
echo "====================================="
echo "To monitor logs: pm2 logs"
echo "To stop services: pm2 stop all"
echo "====================================="