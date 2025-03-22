// tests/validate-config.js
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
    process.exit(1);
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
    process.exit(1);
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
      return 1;
    }
    
    // Try posting a test message to the channel
    const testResponse = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: process.env.SLACK_CHANNEL_ID,
        text: "Configuration test message from SEI Helpdesk Bot (will be deleted)"
      },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${process.env.SLACK_API_TOKEN}`
        }
      }
    );
    
    if (testResponse.data.ok) {
      console.log(`✅ Successfully posted to Slack channel`);
      
      // Delete the test message
      await axios.post(
        'https://slack.com/api/chat.delete',
        {
          channel: process.env.SLACK_CHANNEL_ID,
          ts: testResponse.data.ts
        },
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${process.env.SLACK_API_TOKEN}`
          }
        }
      );
    } else {
      console.error(`❌ Could not post to Slack channel: ${testResponse.data.error}`);
      if (testResponse.data.error === 'not_in_channel') {
        console.error(`   Solution: Invite the bot to the channel with /invite @YourBotName`);
      }
      return 1;
    }
  } catch (error) {
    console.error('❌ Error validating Slack configuration:', error.response?.data || error.message);
    return 1;
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
    return 1;
  }
  
  console.log('Validation complete!');
  return 0;
}

validateConfiguration();