// tests/validate-config.js
// Validates the configuration and environment variables

import dotenv from 'dotenv';
import axios from 'axios';
import { Telegraf } from 'telegraf';
import createLogger from '../modules/logger.js';
import config from '../config.js';

// Initialize logger
const logger = createLogger('validate-config');

// Load environment variables
dotenv.config();

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m'
};

// Required environment variables
const requiredEnvVars = [
  { name: 'TELEGRAM_BOT_TOKEN', description: 'Telegram Bot API Token' },
  { name: 'SLACK_API_TOKEN', description: 'Slack Bot Token (xoxb-)' },
  { name: 'SLACK_CHANNEL_ID', description: 'Slack Channel ID for forwarding messages' },
  { name: 'ZENDESK_API_URL', description: 'Zendesk API URL' },
  { name: 'ZENDESK_EMAIL', description: 'Zendesk Email for API authentication' },
  { name: 'ZENDESK_API_TOKEN', description: 'Zendesk API Token' }
];

// Optional environment variables
const optionalEnvVars = [
  { name: 'SLACK_SIGNING_SECRET', description: 'Slack Signing Secret (for webhook verification)', default: 'Not set - webhook verification disabled' },
  { name: 'DEPLOY_ENV', description: 'Deployment Environment', default: 'development' },
  { name: 'PORT', description: 'Port for webhook server', default: '3030' },
  { name: 'LOG_LEVEL', description: 'Logging Level', default: 'INFO' }
];

// Validate env variables
async function validateEnvVars() {
  console.log(`\n${colors.brightCyan}=== Environment Variables Validation ===${colors.reset}\n`);
  
  let hasErrors = false;
  let hasWarnings = false;
  
  // Check required variables
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar.name]) {
      console.log(`${colors.red}✖ ${envVar.name}: MISSING - ${envVar.description}${colors.reset}`);
      hasErrors = true;
    } else {
      console.log(`${colors.green}✓ ${envVar.name}: Set - ${envVar.description}${colors.reset}`);
    }
  }
  
  // Check optional variables
  for (const envVar of optionalEnvVars) {
    if (!process.env[envVar.name]) {
      console.log(`${colors.yellow}⚠ ${envVar.name}: Not set - ${envVar.description} (default: ${envVar.default})${colors.reset}`);
      hasWarnings = true;
    } else {
      console.log(`${colors.green}✓ ${envVar.name}: Set - ${envVar.description}${colors.reset}`);
    }
  }
  
  // Special validation for Slack API token
  const slackToken = process.env.SLACK_API_TOKEN;
  if (slackToken && !slackToken.startsWith('xoxb-')) {
    console.log(`${colors.red}✖ SLACK_API_TOKEN appears to be invalid: ${slackToken}${colors.reset}`);
    console.log(`${colors.yellow}  For bot integration, the token should start with 'xoxb-'${colors.reset}`);
    hasErrors = true;
  }
  
  // Validate environment
  const envValue = process.env.DEPLOY_ENV || 'development';
  if (envValue !== 'development' && envValue !== 'production') {
    console.log(`${colors.yellow}⚠ DEPLOY_ENV has an unusual value: ${envValue} (expected 'development' or 'production')${colors.reset}`);
    hasWarnings = true;
  }
  
  return { hasErrors, hasWarnings };
}

// Validate team members
function validateTeamMembers() {
  console.log(`\n${colors.brightCyan}=== Team Members Validation ===${colors.reset}\n`);
  
  const teamMembers = config.TEAM_MEMBERS;
  
  if (!teamMembers || !(teamMembers instanceof Set)) {
    console.log(`${colors.red}✖ TEAM_MEMBERS is not properly configured.${colors.reset}`);
    return true;
  }
  
  const memberCount = teamMembers.size;
  console.log(`${colors.green}✓ Found ${memberCount} configured team members.${colors.reset}`);
  
  if (memberCount === 0) {
    console.log(`${colors.yellow}⚠ No team members configured. Message forwarding to Slack won't be available.${colors.reset}`);
    return true;
  }
  
  return false;
}

// Validate Telegram Bot connection
async function validateTelegramBot() {
  console.log(`\n${colors.brightCyan}=== Telegram Bot Validation ===${colors.reset}\n`);
  
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log(`${colors.red}✖ Cannot validate Telegram bot - no token provided${colors.reset}`);
    return true;
  }
  
  try {
    const bot = new Telegraf(token);
    
    console.log(`${colors.blue}ℹ Testing connection to Telegram...${colors.reset}`);
    const botInfo = await bot.telegram.getMe();
    
    console.log(`${colors.green}✓ Connected to Telegram bot: @${botInfo.username} (ID: ${botInfo.id})${colors.reset}`);
    
    return false;
  } catch (error) {
    console.log(`${colors.red}✖ Failed to connect to Telegram: ${error.message}${colors.reset}`);
    return true;
  }
}

// Validate Slack API connection
async function validateSlackAPI() {
  console.log(`\n${colors.brightCyan}=== Slack API Validation ===${colors.reset}\n`);
  
  const token = process.env.SLACK_API_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;
  
  if (!token || !channelId) {
    console.log(`${colors.red}✖ Cannot validate Slack API - token or channel ID missing${colors.reset}`);
    return true;
  }
  
  try {
    console.log(`${colors.blue}ℹ Testing connection to Slack...${colors.reset}`);
    
    // Test auth
    const authResponse = await axios.post(
      'https://slack.com/api/auth.test',
      {},
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
    
    if (!authResponse.data.ok) {
      console.log(`${colors.red}✖ Slack authentication failed: ${authResponse.data.error}${colors.reset}`);
      return true;
    }
    
    console.log(`${colors.green}✓ Authenticated to Slack as: ${authResponse.data.user} (team: ${authResponse.data.team})${colors.reset}`);
    
    // Test channel access
    const channelInfoResponse = await axios.get(
      `https://slack.com/api/conversations.info?channel=${channelId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (!channelInfoResponse.data.ok) {
      console.log(`${colors.red}✖ Cannot access Slack channel: ${channelInfoResponse.data.error}${colors.reset}`);
      if (channelInfoResponse.data.error === 'channel_not_found') {
        console.log(`${colors.yellow}  Make sure the bot is invited to the channel with /invite @YourBotName${colors.reset}`);
      }
      return true;
    }
    
    const channelName = channelInfoResponse.data.channel.name;
    const isPrivate = channelInfoResponse.data.channel.is_private;
    
    console.log(`${colors.green}✓ Can access channel #${channelName} (${isPrivate ? 'private' : 'public'})${colors.reset}`);
    
    // Test permissions by attempting to post and delete a test message
    console.log(`${colors.blue}ℹ Testing message posting permissions...${colors.reset}`);
    
    const postResponse = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: channelId,
        text: '🧪 Configuration test - this message will be deleted',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🧪 *Configuration test*\nThis message will be deleted immediately.'
            }
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
    
    if (!postResponse.data.ok) {
      console.log(`${colors.red}✖ Cannot post messages to channel: ${postResponse.data.error}${colors.reset}`);
      return true;
    }
    
    console.log(`${colors.green}✓ Successfully posted a test message to the channel${colors.reset}`);
    
    // Delete the test message
    try {
      const deleteResponse = await axios.post(
        'https://slack.com/api/chat.delete',
        {
          channel: channelId,
          ts: postResponse.data.ts
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8'
          }
        }
      );
      
      if (!deleteResponse.data.ok) {
        console.log(`${colors.yellow}⚠ Could not delete test message: ${deleteResponse.data.error}${colors.reset}`);
      } else {
        console.log(`${colors.green}✓ Successfully deleted the test message${colors.reset}`);
      }
    } catch (error) {
      console.log(`${colors.yellow}⚠ Error deleting test message: ${error.message}${colors.reset}`);
    }
    
    return false;
  } catch (error) {
    console.log(`${colors.red}✖ Failed to connect to Slack API: ${error.message}${colors.reset}`);
    return true;
  }
}

// Validate Zendesk API connection
async function validateZendeskAPI() {
  console.log(`\n${colors.brightCyan}=== Zendesk API Validation ===${colors.reset}\n`);
  
  const apiUrl = process.env.ZENDESK_API_URL;
  const email = process.env.ZENDESK_EMAIL;
  const token = process.env.ZENDESK_API_TOKEN;
  
  if (!apiUrl || !email || !token) {
    console.log(`${colors.red}✖ Cannot validate Zendesk API - URL, email or token missing${colors.reset}`);
    return true;
  }
  
  try {
    console.log(`${colors.blue}ℹ Testing connection to Zendesk...${colors.reset}`);
    
    // Just try to get some user info to validate the connection
    const response = await axios.get(
      `${apiUrl}/users/me.json`,
      {
        auth: {
          username: `${email}/token`,
          password: token
        }
      }
    );
    
    console.log(`${colors.green}✓ Connected to Zendesk as: ${response.data.user.name} (${response.data.user.email})${colors.reset}`);
    console.log(`${colors.green}✓ Zendesk account: ${response.data.user.url.split('/')[2]}${colors.reset}`);
    
    return false;
  } catch (error) {
    console.log(`${colors.red}✖ Failed to connect to Zendesk API: ${error.message}${colors.reset}`);
    if (error.response) {
      console.log(`${colors.red}  HTTP Status: ${error.response.status}${colors.reset}`);
      console.log(`${colors.red}  Response: ${JSON.stringify(error.response.data)}${colors.reset}`);
    }
    return true;
  }
}

// Validate port availability
async function validatePort() {
  console.log(`\n${colors.brightCyan}=== Port Availability Validation ===${colors.reset}\n`);
  
  const port = process.env.PORT || 3030;
  
  // Attempt to bind to port using a net server
  const net = await import('net');
  const server = net.createServer();
  
  return new Promise((resolve) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`${colors.red}✖ Port ${port} is already in use. The webhook server won't be able to start.${colors.reset}`);
        console.log(`${colors.yellow}  Try running: lsof -i :${port} to see what's using it.${colors.reset}`);
        resolve(true);
      } else {
        console.log(`${colors.red}✖ Error checking port: ${err.message}${colors.reset}`);
        resolve(true);
      }
    });
    
    server.once('listening', () => {
      console.log(`${colors.green}✓ Port ${port} is available for the webhook server${colors.reset}`);
      server.close();
      resolve(false);
    });
    
    server.listen(port, '127.0.0.1');
  });
}

// Check scopes required for the Slack API
async function validateSlackScopes() {
  console.log(`\n${colors.brightCyan}=== Slack API Scopes Validation ===${colors.reset}\n`);
  
  const token = process.env.SLACK_API_TOKEN;
  
  if (!token) {
    console.log(`${colors.red}✖ Cannot validate Slack API scopes - token missing${colors.reset}`);
    return true;
  }
  
  try {
    const response = await axios.get(
      'https://slack.com/api/auth.test',
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (!response.data.ok) {
      console.log(`${colors.red}✖ Slack authentication failed: ${response.data.error}${colors.reset}`);
      return true;
    }
    
    // Get token info to check scopes
    const scopesResponse = await axios.get(
      'https://slack.com/api/apps.permissions.info',
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (!scopesResponse.data.ok) {
      // Most likely this means we don't have the permissions to see the scopes
      console.log(`${colors.yellow}⚠ Could not retrieve Slack API token scopes: ${scopesResponse.data.error}${colors.reset}`);
      console.log(`${colors.yellow}  Make sure the following scopes are added to your Slack App:${colors.reset}`);
    } else {
      // We got back the scopes
      const scopes = scopesResponse.data.info.scopes;
      console.log(`${colors.green}✓ Slack API token has the following scopes: ${scopes.join(', ')}${colors.reset}`);
      
      const missingScopes = [];
      
      // Check for required scopes
      const requiredScopes = [
        'chat:write', 
        'chat:write.public', 
        'channels:read', 
        'groups:read', 
        'reactions:read', 
        'users:read'
      ];
      
      for (const scope of requiredScopes) {
        if (!scopes.includes(scope)) {
          missingScopes.push(scope);
        }
      }
      
      if (missingScopes.length > 0) {
        console.log(`${colors.red}✖ Missing required Slack API scopes: ${missingScopes.join(', ')}${colors.reset}`);
        console.log(`${colors.yellow}  Add these scopes in the Slack API dashboard: https://api.slack.com/apps${colors.reset}`);
        return true;
      }
      
      return false;
    }
    
    // Provide instructions for required scopes
    console.log(`${colors.yellow}  - chat:write - Send messages as the app${colors.reset}`);
    console.log(`${colors.yellow}  - chat:write.public - Send messages to channels the app isn't in${colors.reset}`);
    console.log(`${colors.yellow}  - channels:read - Access channel info${colors.reset}`);
    console.log(`${colors.yellow}  - groups:read - Access private channel info${colors.reset}`);
    console.log(`${colors.yellow}  - reactions:read - View emoji reactions${colors.reset}`);
    console.log(`${colors.yellow}  - users:read - View user info${colors.reset}`);
    console.log(`${colors.yellow}  Add these scopes in the Slack API dashboard: https://api.slack.com/apps${colors.reset}`);
    
    return true;
  } catch (error) {
    console.log(`${colors.red}✖ Failed to validate Slack API scopes: ${error.message}${colors.reset}`);
    return true;
  }
}

// Main function
async function main() {
  console.log(`${colors.brightWhite}========================================${colors.reset}`);
  console.log(`${colors.brightWhite}=== Teledesk Configuration Validator ===${colors.reset}`);
  console.log(`${colors.brightWhite}========================================${colors.reset}`);
  
  const results = [];
  
  // Basic environment variables validation
  const { hasErrors, hasWarnings } = await validateEnvVars();
  results.push({ name: 'Environment Variables', hasErrors, hasWarnings });
  
  if (hasErrors) {
    console.log(`\n${colors.red}✖ Critical environment variables missing. Stopping validation.${colors.reset}`);
    process.exit(1);
  }
  
  // Validate team members configuration
  const teamHasErrors = validateTeamMembers();
  results.push({ name: 'Team Members Configuration', hasErrors: teamHasErrors, hasWarnings: false });
  
  // Check port availability
  const portHasErrors = await validatePort();
  results.push({ name: 'Port Availability', hasErrors: portHasErrors, hasWarnings: false });
  
  // Validate Telegram Bot connection
  const telegramHasErrors = await validateTelegramBot();
  results.push({ name: 'Telegram Bot Connection', hasErrors: telegramHasErrors, hasWarnings: false });
  
  // Validate Slack API connection
  const slackHasErrors = await validateSlackAPI();
  results.push({ name: 'Slack API Connection', hasErrors: slackHasErrors, hasWarnings: false });
  
  // Validate Slack API scopes
  const scopesHasErrors = await validateSlackScopes();
  results.push({ name: 'Slack API Scopes', hasErrors: scopesHasErrors, hasWarnings: false });
  
  // Validate Zendesk API connection
  const zendeskHasErrors = await validateZendeskAPI();
  results.push({ name: 'Zendesk API Connection', hasErrors: zendeskHasErrors, hasWarnings: false });
  
  // Summary
  console.log(`\n${colors.brightCyan}=== Validation Summary ===${colors.reset}\n`);
  
  const totalErrors = results.filter(r => r.hasErrors).length;
  const totalWarnings = results.filter(r => r.hasWarnings).length;
  
  for (const result of results) {
    if (result.hasErrors) {
      console.log(`${colors.red}✖ ${result.name}: Failed${colors.reset}`);
    } else if (result.hasWarnings) {
      console.log(`${colors.yellow}⚠ ${result.name}: Passed with warnings${colors.reset}`);
    } else {
      console.log(`${colors.green}✓ ${result.name}: Passed${colors.reset}`);
    }
  }
  
  console.log(`\n${colors.brightWhite}========================================${colors.reset}`);
  
  if (totalErrors > 0) {
    console.log(`${colors.red}✖ Validation completed with ${totalErrors} errors and ${totalWarnings} warnings.${colors.reset}`);
    console.log(`${colors.red}  Fix the issues above before proceeding.${colors.reset}`);
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log(`${colors.yellow}⚠ Validation completed with ${totalWarnings} warnings.${colors.reset}`);
    console.log(`${colors.yellow}  You can continue, but consider addressing the warnings.${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`${colors.green}✓ Validation completed successfully! All checks passed.${colors.reset}`);
    process.exit(0);
  }
}

main().catch(error => {
  console.error(`${colors.red}An unexpected error occurred:${colors.reset}`, error);
  process.exit(1);
});