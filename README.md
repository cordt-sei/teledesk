# Teledesk

A Telegram bot that forwards messages to Slack and manages support tickets via Zendesk.

## Features

- **Team Workflow**: Forward messages from any Telegram chat to Slack, with reaction-based acknowledgment alerts
- **Support Workflow**: Users can create and interact with Zendesk support tickets directly in Telegram

## Architecture

The application runs two separate Node.js processes:

- **Bot Process**: Handles Telegram interactions and message forwarding
- **Webhook Process**: Handles the web server for test endpoints and manual acknowledgments
- **Reaction-Based Acknowledgment**: Uses polling to detect reactions on Slack messages for acknowledgments

State is shared between processes through file-based persistence.

## Prerequisites

- Node.js v16+
- npm/yarn
- Telegram Bot Token
- Slack workspace with API access
- Zendesk account

## Setup

### 1. Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`
3. Follow prompts to create a bot
4. Save the API token
5. Set commands (optional): `/setcommands` → select your bot → paste:

   ```ini
   start - Start using the support bot
   help - Get help with using the bot
   menu - Show the main menu
   ticket - Create a new support ticket
   status - Check ticket status
   ```

### 2. Slack App

1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name your app and select your workspace
4. Under "OAuth & Permissions" → "Scopes" → add Bot Token Scopes:
   - `chat:write` - Send messages
   - `channels:read` - View channel info
   - `chat:write.public` - Send to public channels  
   - `groups:read` - View private channels
   - `im:read` - View direct messages
   - `mpim:read` - View group DMs
   - `reactions:read` - View emoji reactions
   - `users:read` - View user info
5. Install the app to your workspace
6. Copy the "Bot User OAuth Token" (starts with `xoxb-`)
7. Under "Basic Information" → copy the "Signing Secret"
8. Under "Socket Mode" → ensure it's OFF (we're using HTTP endpoints)
9. Invite the bot to your designated channel with `/invite @YourBotName`

### 3. Zendesk Setup

1. Go to Admin Center → Apps and Integrations → APIs → Zendesk API
2. Create an API token
3. Note your admin email and token

### 4. Project Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/teledesk.git
   cd teledesk
   ```

2. Install dependencies:

   ```bash
   yarn install
   ```

3. Create `.env` file using the example:

   ```bash
   cp .env.example .env
   ```

4. Edit the `.env` file with your credentials:

   ```ini
   # Telegram Configuration
   TELEGRAM_BOT_TOKEN=your_telegram_token

   # Slack Configuration
   SLACK_CHANNEL_ID=your_slack_channel_id
   SLACK_API_TOKEN=xoxb-your_slack_api_token
   SLACK_SIGNING_SECRET=your_slack_signing_secret
   SLACK_WEBHOOK_SERVER=http://your-domain:3030/slack/interactions

   # Zendesk Configuration
   ZENDESK_API_URL=https://yourdomain.zendesk.com/api/v2
   ZENDESK_EMAIL=your_admin_email@example.com
   ZENDESK_API_TOKEN=your_zendesk_token

   # Application Configuration
   DEPLOY_ENV=development  # Options: development, production
   PORT=3030
   LOG_LEVEL=INFO  # Options: ERROR, WARN, INFO, DEBUG, TRACE
   ```

5. Configure team members in `config.js`:
   - Add Telegram user IDs to the `TEAM_MEMBERS` set

6. Create the data directory for state persistence:

   ```bash
   mkdir -p data
   chmod 755 data
   ```

## Running the Application

### Development Mode

Start both the bot and webhook server:

```bash
# Start both processes concurrently
yarn dev
```

### Production Mode

```bash
# Start in production mode with PM2
yarn prod

# Or using the startup script (recommended)
./startup.sh
```

### Using PM2 for Process Management

PM2 configuration is provided in `ecosystem.config.cjs`:

```bash
# Install PM2 globally if needed
yarn global add pm2

# Start with PM2
pm2 start ecosystem.config.cjs

# Set to auto-start on reboot
pm2 startup
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
pm2 save

# Monitor logs
pm2 logs
```

### Testing & Diagnostics

### Validation Scripts

```bash
# Validate configuration
yarn validate

# Test Slack integration
yarn test:slack

# Test webhook server
yarn test:webhook

# Test reactions acknowledgment system
yarn test:reactions

# Diagnose Slack issues
yarn diag:slack

# Diagnose webhook issues
yarn diag:webhook
```

### Testing the Reaction-Based Acknowledgment System

The reaction-based acknowledgment system can be tested using the provided script:

```bash
yarn test:reactions
```

This interactive tool lets you:

1. Create test messages in Slack with pendingAcks entries
2. Add reactions to existing messages
3. Check reactions on existing messages
4. List all pending acknowledgments

### Webhook Endpoints

The webhook server provides several useful endpoints:

- **Health Check**: Check server status

  ```sh
  http://your-host:3030/health
  ```

- **Debug Pending Acks**: View pending acknowledgments

  ```sh
  http://your-host:3030/debug-acks
  ```

- **Manual Acknowledgment**: Send a test acknowledgment

  ```sh
  POST http://your-host:3030/test-acknowledge
  Body: { "chatId": "123456789", "userName": "Test User" }
  ```

### View Logs

```bash
# View latest logs
yarn logs

# Or directly from logs directory
tail -f logs/$(date +%Y-%m-%d).log
```

## Troubleshooting

### Bot Conflict Error

If you get `409: Conflict: terminated by other getUpdates request`:

```bash
# Clear webhooks
yarn clear-webhook

# Or directly run
node clear-webhook.js
```

### Server Won't Start

If the server won't start due to port conflicts:

```bash
# Check what's using port 3030
lsof -i :3030

# Kill the process
kill -15 <PID>
```

### Process Won't Stop

If processes won't stop:

```bash
# Force stop PM2 processes
pm2 delete telegram-bot slack-webhook

# Find and kill any stray processes
pgrep -f "node.*bot.js"
pgrep -f "node.*slackWebhook.js"
kill -9 <PID>
```

## File Structure

- `bot.js` - Main Telegram bot entry point
- `modules/`
  - `logger.js` - Logging utilities
  - `messageHandlers.js` - Telegram message handling
  - `menus.js` - Telegram menu interfaces
  - `slackIntegration.js` - Slack messaging utilities
  - `slackPolling.js` - Reaction-based acknowledgment system
  - `slackWebhook.js` - Webhook server
  - `state.js` - Shared state management
  - `zendeskIntegration.js` - Zendesk ticket handling
- `config.js` - Configuration and team member list
- `ecosystem.config.cjs` - PM2 configuration
- `data/` - State persistence directory
- `logs/` - Application logs
- `tests/` - Diagnostic tools

## Usage

### Team Member Workflow

1. Forward a message from any chat to the bot
2. Provide context about the source if needed
3. Message appears in Slack with instructions to add a reaction for acknowledgment
4. When a team member adds a reaction (like 👍 or ✅), the Telegram user receives confirmation

### Support Workflow

1. Users message the bot directly
2. First message creates a Zendesk ticket
3. Follow-up messages add comments to the ticket
4. New tickets generate Slack notifications with Zendesk link

## License

MIT
