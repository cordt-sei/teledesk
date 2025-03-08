#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TeledeskStack } from '../stacks/teledesk-stack';

const app = new cdk.App();


// Get environment variables for secrets
// In production, these should be stored in AWS Secrets Manager and not passed directly
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const slackApiToken = process.env.SLACK_API_TOKEN;
const slackChannelId = process.env.SLACK_CHANNEL_ID;
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const zendeskApiUrl = process.env.ZENDESK_API_URL;
const zendeskEmail = process.env.ZENDESK_EMAIL;
const zendeskApiToken = process.env.ZENDESK_API_TOKEN;
const teamMembers = process.env.TEAM_MEMBERS;
const approvedGroups = process.env.APPROVED_GROUPS;

// Teledesk bot Stack
new TeledeskStack(app, 'TeledeskStack', {
  telegramBotToken,
  slackApiToken,
  slackChannelId,
  slackSigningSecret,
  zendeskApiUrl,
  zendeskEmail,
  zendeskApiToken,
  teamMembers,
  approvedGroups,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'Serverless Telegram bot for Zendesk and Slack integration',
});

app.synth();