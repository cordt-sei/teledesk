// tests/diagnose-slack.js
import axios from 'axios';
import dotenv from 'dotenv';
import createLogger from '../modules/logger.js';

dotenv.config();

const logger = createLogger('slackDiagnostics');

async function diagnoseSlackSetup() {
  logger.info('Starting Slack setup diagnostics...');
  
  // Check environment variables
  const slackToken = process.env.SLACK_API_TOKEN;
  const slackChannelId = process.env.SLACK_CHANNEL_ID;
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  const webhookUrl = process.env.SLACK_WEBHOOK_SERVER || 'http://localhost:3030/slack/interactions';
  
  const issues = [];
  
  logger.info('Checking environment variables...');
  
  if (!slackToken) {
    issues.push('❌ SLACK_API_TOKEN is not set in environment');
  } else if (!slackToken.startsWith('xoxb-')) {
    issues.push('⚠️ SLACK_API_TOKEN should start with "xoxb-" - you might be using the wrong token type');
  } else {
    logger.info('✅ SLACK_API_TOKEN is properly set');
  }
  
  if (!slackChannelId) {
    issues.push('❌ SLACK_CHANNEL_ID is not set in environment');
  } else {
    logger.info('✅ SLACK_CHANNEL_ID is set');
  }
  
  if (!slackSigningSecret) {
    issues.push('⚠️ SLACK_SIGNING_SECRET is not set - signature verification will be skipped in development');
  } else {
    logger.info('✅ SLACK_SIGNING_SECRET is set');
  }
  
  // Check if webhook server is running
  logger.info(`Checking webhook server at ${webhookUrl}...`);
  try {
    // Check the test endpoint
    const testUrl = webhookUrl.replace('/slack/interactions', '/test');
    const response = await axios.get(testUrl, { timeout: 5000 });
    if (response.status === 200) {
      logger.info(`✅ Webhook server test endpoint is responsive (${response.data})`);
    } else {
      issues.push(`⚠️ Webhook server returned unexpected status: ${response.status}`);
    }
  } catch (error) {
    issues.push(`❌ Webhook server is not reachable at ${webhookUrl.replace('/slack/interactions', '/test')}: ${error.message}`);
  }
  
  // Test Slack API access
  logger.info('Testing Slack API access...');
  try {
    const authResponse = await axios.post('https://slack.com/api/auth.test', {}, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${slackToken}`
      }
    });
    
    if (authResponse.data.ok) {
      logger.info(`✅ Slack API access confirmed (Team: ${authResponse.data.team}, User: ${authResponse.data.user})`);
    } else {
      issues.push(`❌ Slack API access failed: ${authResponse.data.error}`);
    }
  } catch (error) {
    issues.push(`❌ Slack API access test failed: ${error.message}`);
  }
  
  // Check if bot is in the channel
  if (slackToken && slackChannelId) {
    logger.info(`Checking if bot is in channel ${slackChannelId}...`);
    try {
      const channelResponse = await axios.post('https://slack.com/api/conversations.info', 
        `channel=${slackChannelId}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${slackToken}`
        }
      });
      
      if (channelResponse.data.ok) {
        logger.info(`✅ Channel exists: ${channelResponse.data.channel.name}`);
        
        // Check if bot is in channel
        const membersResponse = await axios.post('https://slack.com/api/conversations.members', 
          `channel=${slackChannelId}`, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Bearer ${slackToken}`
          }
        });
        
        if (membersResponse.data.ok) {
          // Get bot's user ID
          const botInfoResponse = await axios.post('https://slack.com/api/auth.test', {}, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${slackToken}`
            }
          });
          
          if (botInfoResponse.data.ok && membersResponse.data.members.includes(botInfoResponse.data.user_id)) {
            logger.info('✅ Bot is a member of the channel');
          } else {
            issues.push(`❌ Bot is not a member of the channel. Add the bot to the channel with /invite @${botInfoResponse.data.user}`);
          }
        } else {
          issues.push(`❌ Couldn't check channel members: ${membersResponse.data.error}`);
        }
      } else {
        issues.push(`❌ Channel check failed: ${channelResponse.data.error}`);
      }
    } catch (error) {
      issues.push(`❌ Channel access test failed: ${error.message}`);
    }
  }
  
  // Check interactivity settings
  logger.info('To complete setup, ensure the following in your Slack App settings:');
  logger.info('1. Interactivity is turned ON');
  logger.info(`2. Request URL is set to ${webhookUrl}`);
  logger.info('3. Bot has the required scopes: chat:write, channels:read, chat:write.public');
  
  // Summary
  if (issues.length > 0) {
    logger.info('\n===== ISSUES FOUND =====');
    issues.forEach(issue => logger.info(issue));
    
    logger.info('\n===== RECOMMENDED ACTIONS =====');
    if (issues.some(i => i.includes('SLACK_API_TOKEN'))) {
      logger.info('• Get a valid Bot Token from Slack App → OAuth & Permissions → Bot User OAuth Token');
    }
    if (issues.some(i => i.includes('SLACK_CHANNEL_ID'))) {
      logger.info('• Get the channel ID by right-clicking on the channel in Slack and copying the ID');
    }
    if (issues.some(i => i.includes('Webhook server'))) {
      logger.info('• Make sure the webhook server is running with: yarn dev:webhook');
      logger.info('• For production, ensure the server is publicly accessible');
    }
    if (issues.some(i => i.includes('Bot is not a member'))) {
      logger.info('• Invite the bot to the channel using /invite @YourBotName');
    }
  } else {
    logger.info('\n✅ All diagnostics passed! Your Slack setup appears to be working correctly.');
  }
}

diagnoseSlackSetup();