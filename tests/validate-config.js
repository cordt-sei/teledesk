// Configuration validation utility
// Save this as validate-config.js

import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

async function validateConfiguration() {
  console.log('Validating configuration...');
  
  // Check required environment variables
  const requiredVars = [
    'TELEGRAM_BOT_TOKEN', 
    'SLACK_API_TOKEN', 
    'SLACK_CHANNEL_ID', 
    'ZENDESK_API_URL', 
    'ZENDESK_EMAIL',
    'ZENDESK_API_TOKEN'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  } else {
    console.log('✅ All required environment variables are set');
  }
  
  // Validate Telegram Token
  try {
    console.log('Testing Telegram Bot Token...');
    const telegramResponse = await axios.get(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`
    );
    console.log(`✅ Telegram Bot Token is valid (Bot: ${telegramResponse.data.result.username})`);
  } catch (error) {
    console.error('❌ Invalid Telegram Bot Token:', error.response?.data || error.message);
  }
  
  // Validate Slack Token and Channel
  try {
    console.log('Testing Slack API Token...');
    
    // Verify if token is correct format
    if (!process.env.SLACK_API_TOKEN.startsWith('xoxb-')) {
      console.warn('⚠️ Slack token should be a bot token starting with xoxb-');
    }
    
    const slackResponse = await axios.post(
      'https://slack.com/api/auth.test',
      {},
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${process.env.SLACK_API_TOKEN}`
        }
      }
    );
    
    if (slackResponse.data.ok) {
      console.log(`✅ Slack API Token is valid (Team: ${slackResponse.data.team})`);
    } else {
      console.error('❌ Invalid Slack API Token:', slackResponse.data.error);
    }
    
    // Check if channel exists and bot has access
    const channelResponse = await axios.post(
      'https://slack.com/api/conversations.info',
      { channel: process.env.SLACK_CHANNEL_ID },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${process.env.SLACK_API_TOKEN}`
        }
      }
    );
    
    if (channelResponse.data.ok) {
      console.log(`✅ Slack channel exists (${channelResponse.data.channel.name})`);
    } else {
      console.error(`❌ Invalid Slack channel ID (${process.env.SLACK_CHANNEL_ID}):`, channelResponse.data.error);
    }
  } catch (error) {
    console.error('❌ Error validating Slack configuration:', error.response?.data || error.message);
  }
  
  // Validate Zendesk credentials
  try {
    console.log('Testing Zendesk API credentials...');
    const zendeskResponse = await axios.get(
      `${process.env.ZENDESK_API_URL}/tickets.json?per_page=1`,
      {
        auth: {
          username: `${process.env.ZENDESK_EMAIL}/token`,
          password: process.env.ZENDESK_API_TOKEN
        }
      }
    );
    
    console.log('✅ Zendesk API credentials are valid');
  } catch (error) {
    console.error('❌ Invalid Zendesk API credentials:', error.response?.data || error.message);
  }
  
  console.log('Validation complete!');
}

validateConfiguration();