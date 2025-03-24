// tests/diag-slack.js
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
    issues.push('🔴 SLACK_API_TOKEN is not set in environment');
  } else if (!slackToken.startsWith('xoxb-')) {
    issues.push('🟡️ SLACK_API_TOKEN should start with "xoxb-" - you might be using the wrong token type');
  } else {
    logger.info('🟢 SLACK_API_TOKEN is properly set');
  }
  
  if (!slackChannelId) {
    issues.push('🔴 SLACK_CHANNEL_ID is not set in environment');
  } else {
    logger.info('🟢 SLACK_CHANNEL_ID is set');
  }
  
  if (!slackSigningSecret) {
    issues.push('🟡️ SLACK_SIGNING_SECRET is not set - signature verification will be skipped in development');
  } else {
    logger.info('🟢 SLACK_SIGNING_SECRET is set');
  }
  
  // Check if webhook server is running
  logger.info(`Checking webhook server at ${webhookUrl}...`);
  try {
    // Check the test endpoint
    const testUrl = webhookUrl.replace('/slack/interactions', '/test');
    const response = await axios.get(testUrl, { timeout: 5000 });
    if (response.status === 200) {
      logger.info(`🟢 Webhook server test endpoint is responsive (${response.data})`);
    } else {
      issues.push(`🟡️ Webhook server returned unexpected status: ${response.status}`);
    }
  } catch (error) {
    issues.push(`🔴 Webhook server is not reachable at ${webhookUrl.replace('/slack/interactions', '/test')}: ${error.message}`);
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
      logger.info(`🟢 Slack API access confirmed (Team: ${authResponse.data.team}, User: ${authResponse.data.user})`);
      
      // Store bot user ID for later checks
      const botUserId = authResponse.data.user_id;
      
      // Check scopes
      logger.info('Checking API token scopes...');
      const scopesResponse = await axios.get('https://slack.com/api/auth.test.scopes', {
        headers: {
          'Authorization': `Bearer ${slackToken}`
        }
      });
      
      if (scopesResponse.data.ok) {
        const scopes = scopesResponse.data.scopes || [];
        logger.info(`Found ${scopes.length} scopes: ${scopes.join(', ')}`);
        
        // Check for required scopes
        const requiredScopes = [
          'chat:write',
          'channels:read',
          'reactions:read',
          'users:read'
        ];
        
        const missingScopes = requiredScopes.filter(scope => !scopes.includes(scope));
        if (missingScopes.length > 0) {
          issues.push(`🔴 Missing required scopes: ${missingScopes.join(', ')}`);
        } else {
          logger.info('🟢 All required scopes are present');
        }
      } else {
        logger.warn(`🟡️ Could not check scopes: ${scopesResponse.data.error}`);
      }
    } else {
      issues.push(`🔴 Slack API access failed: ${authResponse.data.error}`);
    }
  } catch (error) {
    issues.push(`🔴 Slack API access test failed: ${error.message}`);
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
        logger.info(`🟢 Channel exists: ${channelResponse.data.channel.name}`);
        
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
            logger.info('🟢 Bot is a member of the channel');
          } else {
            issues.push(`🔴 Bot is not a member of the channel. Add the bot to the channel with /invite @${botInfoResponse.data.user}`);
          }
        } else {
          // Specific error for missing_scope
          if (membersResponse.data.error === 'missing_scope') {
            issues.push('🔴 Missing required scope: "channels:read" or "groups:read" or "mpim:read" or "im:read"');
            issues.push('   This scope is needed to check channel members. Add it in your Slack App settings → OAuth & Permissions → Scopes');
          } else {
            issues.push(`🔴 Couldn't check channel members: ${membersResponse.data.error}`);
          }
        }
      } else {
        // Specific error for channel_not_found
        if (channelResponse.data.error === 'channel_not_found') {
          issues.push(`🔴 Channel ${slackChannelId} not found. Make sure the channel exists and the bot has access to it.`);
        } else if (channelResponse.data.error === 'missing_scope') {
          issues.push('🔴 Missing required scope: "channels:read" or "groups:read"');
          issues.push('   This scope is needed to check channel info. Add it in your Slack App settings → OAuth & Permissions → Scopes');
        } else {
          issues.push(`🔴 Channel check failed: ${channelResponse.data.error}`);
        }
      }
    } catch (error) {
      issues.push(`🔴 Channel access test failed: ${error.message}`);
    }
  }

  // Test reactions API access
  logger.info('Testing reactions API access...');
  try {
    // Create a test message
    const testMessageResponse = await axios.post('https://slack.com/api/chat.postMessage', {
      channel: slackChannelId,
      text: "Reaction test message (will be deleted)"
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${slackToken}`
      }
    });
    
    if (testMessageResponse.data.ok) {
      const messageTs = testMessageResponse.data.ts;
      logger.info('Test message sent, testing reactions.get API...');
      
      // Test reactions.get
      const reactionsResponse = await axios.get('https://slack.com/api/reactions.get', {
        params: {
          channel: slackChannelId,
          timestamp: messageTs
        },
        headers: {
          'Authorization': `Bearer ${slackToken}`
        }
      });
      
      if (reactionsResponse.data.ok) {
        logger.info('🟢 Successfully accessed reactions API');
      } else {
        if (reactionsResponse.data.error === 'missing_scope') {
          issues.push('🔴 Missing required scope: "reactions:read"');
          issues.push('   This scope is needed for the reaction-based acknowledgment system');
        } else {
          issues.push(`🔴 Cannot access reactions: ${reactionsResponse.data.error}`);
        }
      }
      
      // Delete the test message
      await axios.post('https://slack.com/api/chat.delete', {
        channel: slackChannelId,
        ts: messageTs
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${slackToken}`
        }
      });
    } else {
      logger.error('Could not send test message for reactions check');
    }
  } catch (error) {
    issues.push(`🔴 Reactions API test failed: ${error.message}`);
  }
  
  // Check users API access for user name lookup
  logger.info('Testing users API access for reactions acknowledgment...');
  try {
    // Get bot user ID
    const authResponse = await axios.post('https://slack.com/api/auth.test', {}, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${slackToken}`
      }
    });
    
    if (authResponse.data.ok) {
      const botUserId = authResponse.data.user_id;
      
      // Test users.info
      const usersResponse = await axios.get('https://slack.com/api/users.info', {
        params: {
          user: botUserId
        },
        headers: {
          'Authorization': `Bearer ${slackToken}`
        }
      });
      
      if (usersResponse.data.ok) {
        logger.info('🟢 Successfully accessed users API');
      } else {
        if (usersResponse.data.error === 'missing_scope') {
          issues.push('🔴 Missing required scope: "users:read"');
          issues.push('   This scope is needed to get user names for acknowledgments');
        } else {
          issues.push(`🔴 Cannot access user info: ${usersResponse.data.error}`);
        }
      }
    }
  } catch (error) {
    issues.push(`🔴 Users API test failed: ${error.message}`);
  }
  
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
    if (issues.some(i => i.includes('Missing required scope'))) {
      logger.info('• Go to Slack App settings → OAuth & Permissions → Scopes');
      logger.info('• Add the following Bot Token Scopes:');
      logger.info('  - channels:read (for public channels)');
      logger.info('  - groups:read (for private channels)');
      logger.info('  - reactions:read (for reaction-based acknowledgments)');
      logger.info('  - users:read (for user name lookup in acknowledgments)');
      logger.info('  - im:read (for direct messages)');
      logger.info('  - mpim:read (for group direct messages)');
      logger.info('  - chat:write (for sending messages)');
      logger.info('  - chat:write.public (for sending to channels the bot is not in)');
      logger.info('• Reinstall the app to your workspace after adding the scopes');
    }
  } else {
    logger.info('\n🟢 All diagnostics passed! Your Slack setup appears to be working correctly.');
  }
}

diagnoseSlackSetup();