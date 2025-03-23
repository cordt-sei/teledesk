# Teledesk

A Telegram bot that forwards messages to Slack and manages support tickets via Zendesk.

## Features

- Forward messages from Telegram to Slack with Ack system
- Create support tickets in Zendesk from Telegram messages
- Update tickets with ongoing conversation
- Notify team of new tickets via Slack

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
   ```

### 2. Slack App

1. Go to [Slack API Dashboard](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name your app and select your workspace
4. Under "OAuth & Permissions" → "Scopes" → add Bot Token Scopes:
   - `chat:write`
   - `channels:read`
   - `chat:write.public`
5. Install the app to your workspace
6. Copy the "Bot User OAuth Token"
7. Under "Basic Information" → copy the "Signing Secret"
8. Under "Interactivity & Shortcuts":
   - Turn on Interactivity
   - Set Request URL: `http://your-domain:3030/slack/interactions`

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

3. Create `.env` file:

   ```ini
   TELEGRAM_BOT_TOKEN=your_telegram_token
   SLACK_CHANNEL_ID=your_slack_channel_id
   SLACK_API_TOKEN=xoxb-your_slack_api_token
   SLACK_SIGNING_SECRET=your_slack_signing_secret
   ZENDESK_API_URL=https://yourdomain.zendesk.com/api/v2
   ZENDESK_EMAIL=your_admin_email@example.com
   ZENDESK_API_TOKEN=your_zendesk_token
   DEPLOY_ENV=development
   PORT=3030
   ```

4. Configure `config.js`:
   - Add team member Telegram user IDs to `TEAM_MEMBERS` set

## Running Locally

### Development Mode

```bash
# Start bot and webhook server separately
yarn dev
yarn dev-webhook

# Or use start script
./start-services.sh
```

### Production Mode

```bash
# Install PM2 globally
yarn global add pm2

# Start with PM2
pm2 start ecosystem.config.cjs
```

## Testing

1. Verify webhook server: `curl http://your-domain:3030/test`
2. Forward a message from a team member to the bot
3. Check that the message appears in Slack with an "Acknowledge" button
4. Send a direct message to the bot to test ticket creation

## Troubleshooting

### Bot Conflict Error

If you get `409: Conflict: terminated by other getUpdates request`:

```bash
# Clear webhooks
node clear-webhook.js

# Kill all bot instances
pkill -f "node.*bot.js"
```

### Port or Webhook Issues

1. Check firewall allows port 3030
2. For AWS: verify security group inbound rules
3. Ensure SLACK_SIGNING_SECRET is correctly set

## AWS Deployment

### EC2 Setup

1. Launch EC2 instance (t2.micro is sufficient)
2. Configure security group:
   - Allow SSH (port 22)
   - Allow custom TCP port 3030

### Installation on EC2

```bash
# Update and install Node.js
sudo apt update
sudo apt install -y curl
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install Yarn
npm install -g yarn

# Install PM2
yarn global add pm2

# Clone and setup
git clone https://github.com/yourusername/teledesk.git
cd teledesk
yarn install
cp .env.example .env
nano .env  # Edit with your credentials
```

### Running on EC2

```bash
# Start services
pm2 start ecosystem.config.cjs

# Set to auto-start on reboot
pm2 startup
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
pm2 save

# Monitor logs
pm2 logs
```

### Domain Setup (Optional)

1. Point your domain to EC2 instance IP
2. Install Nginx:

   ```bash
   sudo apt install -y nginx
   ```

3. Create Nginx configuration:

   ```bash
   sudo nano /etc/nginx/sites-available/teledesk
   ```

   Add:

   ```ini
   server {
       listen 80;
       server_name your-domain.com;

       location /slack/interactions {
           proxy_pass http://localhost:3030;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

4. Enable the site:

   ```bash
   sudo ln -s /etc/nginx/sites-available/teledesk /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

## File Structure

- `bot.js` - Telegram bot logic
- `slack-webhook.js` - Handles Slack interactions
- `zendesk.js` - Support ticket management
- `config.js` - Configuration and team member list
- `ecosystem.config.cjs` - PM2 configuration

## Usage

### Team Member Workflow

1. Forward a message from any chat to the bot
2. If source isn't detected, bot asks for origin
3. Message appears in Slack with Ack button
4. When clicked, bot notifies the original forwarder

### Support Workflow

1. Users message the bot directly
2. First message creates a Zendesk ticket
3. Follow-up messages add comments to the ticket
4. New tickets generate Slack notifications with Zendesk link

## License

MIT
