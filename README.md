# Teledesk

A Telegram bot that forwards messages to Slack and manages support tickets. This project integrates Telegram, Slack, and Zendesk to provide a unified support system.

## Features

- Forward messages from Telegram to Slack with acknowledgment system
- Create support tickets in Zendesk from Telegram messages
- Update tickets with ongoing conversation
- Notify team of new tickets via Slack

## Prerequisites

- Node.js v16+
- npm
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- A Slack workspace with API access
- A Zendesk account

## Setup

### Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

And fill in your values:

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from BotFather
- `SLACK_CHANNEL_ID`: ID of the Slack channel where messages will be posted
- `SLACK_API_TOKEN`: Bot User OAuth Token from your Slack app
- `SLACK_SIGNING_SECRET`: Signing Secret from your Slack app
- `ZENDESK_API_URL`: Your Zendesk API URL (usually https://yourdomain.zendesk.com/api/v2)
- `ZENDESK_EMAIL`: Your Zendesk admin email
- `ZENDESK_API_TOKEN`: Your Zendesk API token
- `DEPLOY_ENV`: Environment (`development` or `production`)
- `PORT`: Port for the webhook server (default: 3000)

### Telegram Setup

1. Create a new bot via [@BotFather](https://t.me/BotFather)
2. Get the bot token and add it to your `.env` file
3. Set up commands for your bot (optional):
   ```
   start - Start using the support bot
   help - Get help with using the bot
   ```

### Slack App Setup

1. Go to [Slack API Dashboard](https://api.slack.com/apps) and create a new app
2. Under "OAuth & Permissions", add the following bot token scopes:
   - `chat:write`
   - `channels:read`
   - `chat:write.public`
3. Install the app to your workspace
4. Copy the "Bot User OAuth Token" to your `.env` as `SLACK_API_TOKEN`
5. Under "Basic Information", copy the "Signing Secret" to your `.env` as `SLACK_SIGNING_SECRET`
6. Under "Interactivity & Shortcuts":
   - Turn on Interactivity
   - Set the Request URL to `http://basementnodes.ca:3030/slack/interactions` (or your server URL)

### Zendesk Setup

1. In Zendesk Admin Center, go to "Apps and Integrations" → "APIs" → "Zendesk API"
2. Create a new API token
3. Add your admin email and the token to your `.env` file

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/teledesk.git
cd teledesk

# Install dependencies
npm install

# Run the bot (development)
npm run dev

# Run the webhook server (development)
npm run dev-webhook

# Deploy with PM2
npm run deploy
```

## Testing the Webhook

To test if your webhook server is properly configured:

1. Visit http://basementnodes.ca:3030/test in your browser
   - You should see "Webhook server is running!"

2. Forward a message from Telegram to your bot (as a team member)
   - The message should appear in Slack with an "Acknowledge" button
   - When clicked, your Telegram user should receive an acknowledgment message

## Local Development with ngrok

For local development without a public server:

1. Install ngrok:
   ```bash
   npm install -g ngrok
   ```

2. Start your webhook server:
   ```bash
   npm run dev-webhook
   ```

3. Create a tunnel to your local server:
   ```bash
   ngrok http 3000
   ```

4. Use the HTTPS URL from ngrok for your Slack Interactivity Request URL

## Usage

### Team Member Workflow

1. Forward a message from any Telegram chat to the bot
2. The bot will ask for the source if it cannot determine it
3. The message will be posted to Slack with an "Acknowledge" button
4. When a team member clicks the button, the original sender will be notified

### User Support Workflow

1. Users send messages directly to the bot
2. Each message creates a new support ticket in Zendesk
3. Follow-up messages are added as comments to the existing ticket
4. New tickets are posted to Slack with a link to view in Zendesk

## Deployment

For production deployment, use PM2:

```bash
npm run deploy
```

This will start both the bot and webhook server as defined in `ecosystem.config.js`.

## Troubleshooting

- **Slack button doesn't work**: Check that your server is accessible and the Slack Interactivity Request URL is correct
- **Webhook validation fails**: Ensure your `SLACK_SIGNING_SECRET` is correctly set
- **Zendesk tickets aren't created**: Verify your Zendesk API credentials

## License

MIT