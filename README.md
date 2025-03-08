# Serverless Teledesk

A serverless Telegram bot that forwards messages to Slack and manages support tickets via Zendesk, deployed on AWS using CDK.

## Architecture

This application uses a serverless architecture with the following AWS services:

- **API Gateway**: Handles webhook requests from Telegram and Slack
- **Lambda**: Processes messages and interactions
- **DynamoDB**: Stores state and conversation history
- **Secrets Manager**: Securely stores API tokens and credentials

## Key Features

- Forward messages from Telegram to Slack with acknowledgment system
- Create support tickets in Zendesk from Telegram messages
- Update tickets with ongoing conversation
- Notify team of new tickets via Slack
- Fully serverless - no servers to manage
- Automatic scaling for high availability
- Secure credential storage

## Prerequisites

- AWS Account
- AWS CLI installed and configured
- Node.js v16+ and npm/yarn
- Telegram Bot Token
- Slack workspace with API access
- Zendesk account

## Setup

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/serverless-teledesk.git
cd serverless-teledesk
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file with your credentials:

```ini
TELEGRAM_BOT_TOKEN=your_telegram_token
SLACK_CHANNEL_ID=your_slack_channel_id
SLACK_API_TOKEN=xoxb-your_slack_api_token
SLACK_SIGNING_SECRET=your_slack_signing_secret
ZENDESK_API_URL=https://yourdomain.zendesk.com/api/v2
ZENDESK_EMAIL=your_admin_email@example.com
ZENDESK_API_TOKEN=your_zendesk_token
TEAM_MEMBERS=1705203106,5417931154,508458486
```

> Note: For production, it's better to store these credentials directly in AWS Secrets Manager and not in the `.env` file.

### 4. Deploy to AWS

```bash
# Bootstrap CDK in your AWS account (if not done before)
npm run bootstrap

# Build Lambda functions
npm run build

# Deploy the stack
npm run deploy
```

## How it Works

### Components

1. **Telegram Webhook Handler**: Processes incoming messages from Telegram
2. **Slack Interactions Handler**: Processes button clicks and actions from Slack
3. **Zendesk Integration**: Creates and updates support tickets
4. **DynamoDB Tables**:
   - `ActiveTicketsTable`: Tracks open support tickets
   - `UserStatesTable`: Stores conversation flow state
   - `SlackAcknowledgmentsTable`: Tracks pending acknowledgments

### Workflows

#### Team Member Forward Flow

1. A team member forwards a message from any chat to the bot
2. If source isn't detected, bot asks for origin
3. Message appears in Slack with acknowledgment button
4. When clicked, bot notifies the original forwarder

#### Support Ticket Flow

1. Users message the bot directly
2. First message creates a Zendesk ticket
3. Follow-up messages add comments to the ticket
4. New tickets generate Slack notifications with Zendesk link

## Project Structure

```
├── bin/
│   └── cdk.ts                  # CDK app entry point
├── lambda/
│   ├── telegram-webhook.js     # Telegram webhook handler
│   ├── slack-interactions.js   # Slack interactions handler
│   ├── set-webhook.js          # Webhook setup utility
│   └── zendesk.js              # Support ticket management
├── stacks/
│   └── teledesk-stack.ts       # CDK stack definition
├── dist/                       # Built Lambda functions
├── rollup.config.js            # Rollup build configuration
├── package.json                # Project dependencies
└── README.md                   # Documentation
```

## Testing After Deployment

1. Get the API Gateway URL from the CloudFormation outputs
2. Use the provided Slack Interactions URL in your Slack app settings
3. Test sending messages to your Telegram bot
4. Check that messages appear in Slack with acknowledgment buttons
5. Monitor Lambda logs in CloudWatch for debugging

## Monitoring and Maintenance

- **CloudWatch**: View logs from Lambda functions
- **API Gateway Console**: Monitor API requests and latency
- **DynamoDB Console**: Check table data and perform backups
- **Lambda Console**: Monitor function invocations and errors

## Cleaning Up

To remove all resources created by this project:

```bash
npm run destroy
```

## Advanced Configuration

### Customizing Lambda Settings

Adjust memory, timeout, and other settings in `teledesk-stack.ts`.

### Using Custom Domains

For a more professional URL, add custom domain configuration to the API Gateway.

### Implementing Automatic Backups

Enable DynamoDB Point-in-Time Recovery and scheduled backups for data safety.

## Troubleshooting

### Common Issues

1. **Webhook not working**: Check the API Gateway URL format and security settings
2. **Lambda function errors**: View CloudWatch logs for detailed error messages
3. **DynamoDB capacity errors**: Switch to on-demand billing if experiencing throttling

## License

MIT