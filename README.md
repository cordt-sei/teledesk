# Teledesk

A Telegram bot that forwards messages to Slack and manages support tickets via Zendesk.

## Features

- **Team Workflow**: Forward messages from whitelisted Telegram users directly to Slack, with acknowledgment alerts
- **Support Workflow**: Users can create and interact through Zendesk support tickets directly in Telegram

## Architecture

The application runs two separate Node.js processes:

- **Bot Process**: Handles Telegram interactions and message forwarding
- **Webhook Process**: Handles Slack interaction callbacks and acknowledgments

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

   ```sh
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
   - `chat:write`
   - `channels:read`
   - `chat:write.public`
   - `groups:read` (for private channels)
   - `im:read` (for direct messages)
   - `mpim:read` (for group direct messages)
5. Install the app to your workspace
6. Copy the "Bot User OAuth Token" (starts with `xoxb-`)
7. Under "Basic Information" → copy the "Signing Secret"
8. Under "Interactivity & Shortcuts":
   - Turn on Interactivity
   - Set Request URL: `http://your-domain:3030/slack/interactions`
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
   TELEGRAM_BOT_TOKEN=your_telegram_token
   SLACK_CHANNEL_ID=your_slack_channel_id
   SLACK_API_TOKEN=xoxb-your_slack_api_token
   SLACK_SIGNING_SECRET=your_slack_signing_secret
   SLACK_WEBHOOK_SERVER=http://your-domain:3030/slack/interactions
   ZENDESK_API_URL=https://yourdomain.zendesk.com/api/v2
   ZENDESK_EMAIL=your_admin_email@example.com
   ZENDESK_API_TOKEN=your_zendesk_token
   DEPLOY_ENV=development
   PORT=3030
   LOG_LEVEL=INFO
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

# Or start them separately
yarn dev:bot
yarn dev:webhook
```

### Production Mode

```bash
# Start in production mode with PM2
yarn prod

# Or using the startup script
./startup.sh
```

### Using PM2 for Process Management

```bash
# Install PM2 globally
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

## Testing & Diagnostics

### Validation Scripts

```bash
# Validate configuration
yarn validate

# Test Slack integration
yarn test:slack

# Diagnose Slack issues
yarn diagnose:slack
```

### Webhook Debug Endpoint

Check pending acknowledgments:

```sh
http://your-host:3030/debug-acks
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

### Slack Issues

If acknowledgments aren't working:

1. Check the `data/pendingAcks.json` file for stored acknowledgments
2. Verify the webhook server is running with `curl http://localhost:3030/test`
3. Ensure Slack app interactivity URL points to your server
4. Check that the Slack app has correct scopes and permissions

## File Structure

- `bot.js` - Main Telegram bot entry point
- `modules/`
  - `logger.js` - Logging utilities
  - `messageHandlers.js` - Telegram message handling
  - `menus.js` - Telegram menu interfaces
  - `slackIntegration.js` - Slack messaging and ack handling
  - `slackWebhook.js` - Webhook server for Slack interactions
  - `state.js` - Shared state management
  - `zendeskIntegration.js` - Zendesk ticket handling
- `config.js` - Configuration and team member list
- `data/` - State persistence directory
- `logs/` - Application logs
- `tests/` - Diagnostic tools

## Usage

### Team Member Workflow

1. Forward a message from any chat to the bot
2. Provide context about the source
3. Message appears in Slack with Acknowledge button
4. When clicked, the Telegram user receives confirmation

### Support Workflow

1. Users message the bot directly
2. First message creates a Zendesk ticket
3. Follow-up messages add comments to the ticket
4. New tickets generate Slack notifications with Zendesk link

## License

MIT
