// tests/test-ack.js
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import createLogger from '../modules/logger.js';

dotenv.config();

const logger = createLogger('ackVerifier');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pendingAcksFile = path.join(__dirname, '..', 'data', 'pendingAcks.json');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper to ask questions
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function verifyAckFlow() {
  try {
    logger.info('Starting acknowledgment flow verification');
    
    // Check if required environment variables are set
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const slackToken = process.env.SLACK_API_TOKEN;
    const slackChannelId = process.env.SLACK_CHANNEL_ID;
    
    if (!telegramToken || !slackToken || !slackChannelId) {
      logger.error('Missing required environment variables. Please check your .env file');
      process.exit(1);
    }
    
    // 1. Check if we have any pending acknowledgments
    let pendingAcks = {};
    try {
      const data = await fs.readFile(pendingAcksFile, 'utf8');
      pendingAcks = JSON.parse(data);
      logger.info(`Found ${Object.keys(pendingAcks).length} pending acknowledgments`);
    } catch (error) {
      logger.info('No pending acknowledgments found or could not read file');
      pendingAcks = {};
    }
    
    if (Object.keys(pendingAcks).length === 0) {
      console.log('\nNo pending acknowledgments found. Would you like to:');
      console.log('1. Create a test message in Slack with an acknowledgment button');
      console.log('2. Manually test sending a message to Telegram');
      console.log('3. Exit');
      
      const choice = await question('Enter your choice (1-3): ');
      
      if (choice === '1') {
        await createTestSlackMessage();
      } else if (choice === '2') {
        await testDirectTelegramMessage();
      } else {
        console.log('Exiting...');
        rl.close();
        return;
      }
    } else {
      // We have pending acks, let's test acknowledging one
      console.log('\nPending acknowledgments found:');
      
      Object.entries(pendingAcks).forEach(([key, value], index) => {
        console.log(`${index + 1}. Message ts: ${key}`);
        console.log(`   Chat ID: ${value.telegramChatId}`);
        console.log(`   Forwarder: ${value.forwarder || 'Unknown'}`);
        console.log(`   Time: ${new Date(value.timestamp).toLocaleString()}`);
        console.log('---');
      });
      
      console.log('\nOptions:');
      console.log('1. Simulate Slack button click (standard webhook)');
      console.log('2. Use direct test endpoint (recommended)');
      console.log('3. Create a new test message in Slack');
      console.log('4. Test sending a direct message to Telegram');
      console.log('5. Exit');
      
      const choice = await question('Enter your choice (1-5): ');
      
      if (choice === '1') {
        const index = await question(`Enter the number of the message to acknowledge (1-${Object.keys(pendingAcks).length}): `);
        const messageTs = Object.keys(pendingAcks)[parseInt(index) - 1];
        
        if (messageTs) {
          await simulateAckButtonClick(messageTs, pendingAcks[messageTs]);
        } else {
          console.log('Invalid selection.');
        }
      } else if (choice === '2') {
        const index = await question(`Enter the number of the message to acknowledge (1-${Object.keys(pendingAcks).length}): `);
        const messageTs = Object.keys(pendingAcks)[parseInt(index) - 1];
        
        if (messageTs) {
          await useDirectTestEndpoint(messageTs, pendingAcks[messageTs]);
        } else {
          console.log('Invalid selection.');
        }
      } else if (choice === '3') {
        await createTestSlackMessage();
      } else if (choice === '4') {
        await testDirectTelegramMessage();
      } else {
        console.log('Exiting...');
      }
    }
    
    rl.close();
  } catch (error) {
    logger.error('Error during verification:', error);
    rl.close();
  }
}

async function createTestSlackMessage() {
  try {
    logger.info('Creating a test message in Slack...');
    
    const messageText = "🧪 *TEST MESSAGE* 🧪\n\nThis is an automated test of the Slack Ack system.";
    
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: process.env.SLACK_CHANNEL_ID,
        text: messageText,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: messageText
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Acknowledge"
                },
                style: "primary",
                action_id: "acknowledge_forward",
                value: `test_ack_${Date.now()}`
              }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${process.env.SLACK_API_TOKEN}`
        }
      }
    );
    
    if (response.data.ok) {
      logger.info(`Test message created in Slack with timestamp: ${response.data.ts}`);
      console.log('\nTest message created in Slack.');
      console.log('Now click the "Acknowledge" button in Slack to test the flow.');
      console.log(`Message timestamp: ${response.data.ts}`);
      
      // Ask if the user would like to add this to pendingAcks for testing
      const shouldAdd = await question('Would you like to add this message to pendingAcks for testing? (y/n): ');
      
      if (shouldAdd.toLowerCase() === 'y') {
        const chatId = await question('Enter a Telegram chat ID to send the acknowledgment to: ');
        
        if (chatId) {
          try {
            // Read existing pendingAcks
            let pendingAcks = {};
            try {
              const data = await fs.readFile(pendingAcksFile, 'utf8');
              pendingAcks = JSON.parse(data);
            } catch (error) {
              // File might not exist, that's OK
              // Create directory if it doesn't exist
              await fs.mkdir(path.dirname(pendingAcksFile), { recursive: true }).catch(() => {});
            }
            
            // Add our test message
            pendingAcks[response.data.ts] = {
              telegramChatId: chatId,
              telegramMessageId: 0,
              forwarder: 'Test User',
              message: messageText,
              timestamp: Date.now()
            };
            
            // Write back to file
            await fs.writeFile(pendingAcksFile, JSON.stringify(pendingAcks, null, 2));
            
            logger.info('Added test message to pendingAcks.json');
            console.log('Test message added to pendingAcks.json');
          } catch (error) {
            logger.error('Error adding to pendingAcks:', error);
            console.log('Error:', error.message);
          }
        }
      }
    } else {
      logger.error('Failed to create test message in Slack:', response.data.error);
    }
  } catch (error) {
    logger.error('Error creating test message:', error);
  }
}

async function testDirectTelegramMessage() {
  try {
    const chatId = await question('Enter a Telegram chat ID to test sending a message to: ');
    
    if (!chatId) {
      console.log('No chat ID provided, skipping test.');
      return;
    }
    
    logger.info(`Testing direct message to Telegram chat ID: ${chatId}`);
    
    const response = await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text: '🧪 This is a test message sent directly via the Telegram API.'
      }
    );
    
    if (response.data.ok) {
      logger.info('Successfully sent test message to Telegram');
      console.log('\nTest message sent successfully to Telegram!');
      console.log('Message ID:', response.data.result.message_id);
    } else {
      logger.error('Failed to send test message to Telegram:', response.data);
      console.log('\nFailed to send test message to Telegram.');
    }
  } catch (error) {
    logger.error('Error sending test message:', error);
    console.log('\nFailed to send test message to Telegram.');
  }
}

async function simulateAckButtonClick(messageTs, pendingInfo) {
  try {
    const webhookUrl = process.env.SLACK_WEBHOOK_SERVER || 'http://localhost:3030/slack/interactions';
    logger.info(`Simulating Ack button click for message ${messageTs}`);
    
    // Create a mock payload similar to what Slack would send
    const now = Math.floor(Date.now() / 1000);
    const mockPayload = {
      type: 'block_actions',
      user: {
        id: 'TEST_USER',
        username: 'Test User',
        name: 'Test User'
      },
      api_app_id: 'TEST_APP',
      token: 'test_token',
      trigger_id: `${Date.now()}.test`,
      team: { id: 'TEST_TEAM', domain: 'testteam' },
      channel: { id: process.env.SLACK_CHANNEL_ID, name: 'testchannel' },
      message: {
        type: 'message',
        text: 'Test Message',
        ts: messageTs,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Test Message'
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Acknowledge'
                },
                action_id: 'acknowledge_forward'
              }
            ]
          }
        ]
      },
      actions: [
        {
          action_id: 'acknowledge_forward',
          block_id: 'test_block',
          text: {
            type: 'plain_text',
            text: 'Acknowledge'
          },
          type: 'button',
          value: `test_ack_${Date.now()}`,
          action_ts: `${now}`
        }
      ]
    };
    
    const payloadStr = `payload=${encodeURIComponent(JSON.stringify(mockPayload))}`;
    
    console.log('\nSending webhook request to:', webhookUrl);
    console.log('This simulates someone clicking the "Acknowledge" button in Slack.');
    console.log(`Target Telegram chat: ${pendingInfo.telegramChatId}`);
    
    try {
      // Use a timeout to ensure we don't wait forever
      const response = await axios.post(webhookUrl, payloadStr, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Slack-Request-Timestamp': now.toString(),
          'X-Slack-Signature': 'v0=test_signature' // Not used in dev mode
        },
        validateStatus: null, // Don't throw on any status code
        timeout: 5000 // 5 second timeout
      });
      
      if (response.status === 200) {
        logger.info('Webhook request sent successfully');
        console.log('\nWebhook request sent successfully!');
        console.log('Check your Telegram client to see if the acknowledgment was received.');
      } else {
        logger.warn(`Webhook received a non-200 response code: ${response.status}`);
        console.log(`\nWarning: Webhook server returned status ${response.status}`);
      }
    } catch (error) {
      logger.error('Error sending webhook request:', error);
      console.log('\nFailed to send webhook request. Is the webhook server running?');
      
      if (error.code === 'ECONNREFUSED') {
        console.log(`Webhook server not reachable at ${webhookUrl}. Make sure it's running.`);
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
        console.log(`Webhook request timed out. The server might be slow to respond.`);
      } else {
        console.log('Error:', error.message);
      }
    }
  } catch (error) {
    logger.error('Error simulating Ack button click:', error);
  }
}

async function useDirectTestEndpoint(messageTs, pendingInfo) {
  try {
    // Get the base URL from the webhook server URL
    const baseUrl = (process.env.SLACK_WEBHOOK_SERVER || 'http://localhost:3030/slack/interactions')
      .replace('/slack/interactions', '');
    const testUrl = `${baseUrl}/test-acknowledge`;
    
    logger.info(`Using direct test endpoint for message ${messageTs}`);
    
    console.log('\nSending direct test request to:', testUrl);
    console.log(`Target Telegram chat: ${pendingInfo.telegramChatId}`);
    
    try {
      const response = await axios.post(testUrl, {
        messageTs: messageTs,
        chatId: pendingInfo.telegramChatId,
        userName: 'Test User'
      }, {
        timeout: 5000 // 5 second timeout
      });
      
      console.log('\nTest request result:', response.data);
      
      if (response.data.success) {
        console.log('\nAcknowledgment sent successfully!');
        console.log('Check your Telegram client to see if the acknowledgment was received.');
      } else {
        console.log('\nFailed to send acknowledgment via test endpoint.');
      }
    } catch (error) {
      logger.error('Error using test endpoint:', error);
      console.log('\nFailed to use test endpoint. Error:', error.message);
      
      if (error.code === 'ECONNREFUSED') {
        console.log(`Server not reachable at ${testUrl}. Make sure it's running.`);
      } else if (error.response) {
        console.log('Server response:', error.response.data);
      }
    }
  } catch (error) {
    logger.error('Error using direct test endpoint:', error);
  }
}

// Run the verification
verifyAckFlow().catch(err => {
  logger.error('Verification error:', err);
  rl.close();
});