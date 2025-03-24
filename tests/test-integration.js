// tests/integration-test.js
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pendingAcksFile = path.join(__dirname, '..', 'data', 'pendingAcks.json');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper to ask questions
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function testIntegration() {
  try {
    console.log('Telegram-Slack Integration Test');
    console.log('===============================');
    
    // Check for required environment variables
    const requiredVars = [
      'TELEGRAM_BOT_TOKEN',
      'SLACK_API_TOKEN',
      'SLACK_CHANNEL_ID'
    ];
    
    const missingVars = requiredVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
      console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
      rl.close();
      return;
    }
    
    // Get chat ID
    const chatId = await question('Enter a test Telegram chat ID: ');
    if (!chatId) {
      console.log('No chat ID provided. Exiting.');
      rl.close();
      return;
    }
    
    // STEP 1: Create a test message in Slack
    console.log('\n📤 Step 1: Creating test message in Slack...');
    
    const messageText = '🧪 TEST MESSAGE - Integration Test';
    const forwardId = `test_${Date.now()}`;
    
    const slackResponse = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: process.env.SLACK_CHANNEL_ID,
        text: messageText,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📢 *Forwarded Message*\n\n*Source:* Integration Test\n*Forwarded by:* Test Script\n*Context:* Testing ack flow`
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Message:*\n${messageText}`
            }
          },
          {
            type: "actions",
            block_id: `ack_block_${forwardId}`,
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Acknowledge",
                  emoji: true
                },
                style: "primary",
                action_id: "acknowledge_forward",
                value: `ack_${forwardId}`
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
    
    if (!slackResponse.data.ok) {
      console.error(`❌ Failed to create Slack message: ${slackResponse.data.error}`);
      rl.close();
      return;
    }
    
    const messageTs = slackResponse.data.ts;
    console.log(`✅ Test message created in Slack with timestamp: ${messageTs}`);
    
    // STEP 2: Create a test status message in Telegram
    console.log('\n📱 Step 2: Creating status message in Telegram...');
    
    const telegramResponse = await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text: "Message forwarded to Slack - status will update upon Ack from the team."
      }
    );
    
    if (!telegramResponse.data.ok) {
      console.error(`❌ Failed to send Telegram message: ${telegramResponse.data.description}`);
      rl.close();
      return;
    }
    
    const statusMessageId = telegramResponse.data.result.message_id;
    console.log(`✅ Status message sent to Telegram with ID: ${statusMessageId}`);
    
    // STEP 3: Create the pendingAck entry
    console.log('\n💾 Step 3: Creating pendingAck entry...');
    
    // First check if data directory exists
    const dataDir = path.join(__dirname, '..', 'data');
    await fs.mkdir(dataDir, { recursive: true });
    
    // Prepare the pending ack data
    const pendingInfo = {
      telegramChatId: chatId,
      telegramMessageId: 0, // Not needed for this test
      forwarder: "Test Script",
      timestamp: Date.now(),
      statusMessageId: statusMessageId
    };
    
    // Read existing data
    let pendingAcks = {};
    try {
      const data = await fs.readFile(pendingAcksFile, 'utf8');
      if (data && data.trim() !== '') {
        pendingAcks = JSON.parse(data);
      }
    } catch (error) {
      console.log('No existing pendingAcks file, creating new one');
    }
    
    // Add our test entry
    pendingAcks[messageTs] = pendingInfo;
    
    // Write back to file
    await fs.writeFile(pendingAcksFile, JSON.stringify(pendingAcks, null, 2));
    console.log(`✅ Added entry to pendingAcks.json for message ${messageTs}`);
    
    // STEP 4: Test both acknowledgment methods
    console.log('\n🔄 Step 4: Testing acknowledgment options');
    console.log('1. Use webhook endpoint (standard flow)');
    console.log('2. Use direct test endpoint (alternative flow)');
    console.log('3. Skip and exit');
    
    const choice = await question('Enter your choice (1-3): ');
    
    if (choice === '1') {
      // Test webhook flow
      console.log('\n🧪 Testing standard webhook flow...');
      
      // Create a mock payload similar to what Slack would send
      const now = Math.floor(Date.now() / 1000);
      const mockPayload = {
        type: 'block_actions',
        user: {
          id: 'TEST_USER',
          username: 'testuser',
          name: 'Test User'
        },
        api_app_id: 'TEST_APP',
        token: 'test_token',
        trigger_id: `${Date.now()}.test`,
        team: { id: 'TEST_TEAM', domain: 'testteam' },
        channel: { id: process.env.SLACK_CHANNEL_ID, name: 'testchannel' },
        message: {
          type: 'message',
          text: messageText,
          ts: messageTs,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `📢 *Forwarded Message*\n\n*Source:* Integration Test\n*Forwarded by:* Test Script\n*Context:* Testing ack flow`
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Message:*\n${messageText}`
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
            block_id: `ack_block_${forwardId}`,
            text: {
              type: 'plain_text',
              text: 'Acknowledge'
            },
            type: 'button',
            value: `ack_${forwardId}`,
            action_ts: `${now}`
          }
        ]
      };
      
      const payloadStr = `payload=${encodeURIComponent(JSON.stringify(mockPayload))}`;
      const webhookUrl = process.env.SLACK_WEBHOOK_SERVER || 'http://localhost:3030/slack/interactions';
      
      console.log(`Sending webhook request to: ${webhookUrl}`);
      console.log(`This simulates someone clicking the "Acknowledge" button in Slack.`);
      
      try {
        // Use a reasonable timeout
        const response = await axios.post(webhookUrl, payloadStr, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Slack-Request-Timestamp': now.toString(),
            'X-Slack-Signature': 'v0=test_signature' // Not used in dev mode
          },
          timeout: 5000
        });
        
        console.log(`\n✅ Webhook response status: ${response.status}`);
        console.log('Check your Telegram client to see if the acknowledgment was received.');
        console.log('The status message should be updated with an acknowledgment notification.');
      } catch (error) {
        console.error(`\n❌ Webhook request error: ${error.message}`);
        
        if (error.code === 'ECONNREFUSED') {
          console.log(`Server not reachable at ${webhookUrl}. Make sure it's running.`);
        } else if (error.code === 'ETIMEDOUT') {
          console.log('Request timed out. The server might be taking too long to respond.');
          console.log('This could be normal if the webhook is processing asynchronously.');
          console.log('Check your Telegram client to see if the acknowledgment was still received.');
        }
      }
    } else if (choice === '2') {
      // Test direct endpoint
      console.log('\n🧪 Testing direct test endpoint...');
      
      const baseUrl = (process.env.SLACK_WEBHOOK_SERVER || 'http://localhost:3030/slack/interactions')
        .replace('/slack/interactions', '');
      const testUrl = `${baseUrl}/test-acknowledge`;
      
      console.log(`Sending direct test request to: ${testUrl}`);
      
      try {
        const response = await axios.post(testUrl, {
          messageTs: messageTs,
          chatId: chatId,
          userName: 'Test User'
        });
        
        console.log('\n✅ Test acknowledgment response:', response.data);
        
        if (response.data.success) {
          console.log('Test acknowledgment sent successfully!');
          console.log('Check your Telegram client to see if the message was updated.');
        } else {
          console.log('Failed to send acknowledgment via test endpoint.');
        }
      } catch (error) {
        console.error(`\n❌ Test endpoint error: ${error.message}`);
        
        if (error.code === 'ECONNREFUSED') {
          console.log(`Server not reachable at ${testUrl}. Make sure it's running.`);
        }
      }
    } else {
      console.log('Skipping acknowledgment test...');
    }
    
    // STEP 5: Clean up
    console.log('\n🧹 Step 5: Cleaning up...');
    
    const cleanupChoice = await question('Would you like to delete the test message from Slack? (y/n): ');
    
    if (cleanupChoice.toLowerCase() === 'y') {
      try {
        const deleteResponse = await axios.post(
          'https://slack.com/api/chat.delete',
          {
            channel: process.env.SLACK_CHANNEL_ID,
            ts: messageTs
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.SLACK_API_TOKEN}`
            }
          }
        );
        
        if (deleteResponse.data.ok) {
          console.log('✅ Test message deleted from Slack');
        } else {
          console.log(`❌ Failed to delete Slack message: ${deleteResponse.data.error}`);
        }
      } catch (error) {
        console.error(`❌ Error deleting Slack message: ${error.message}`);
      }
    }
    
    console.log('\nTest completed! Check your logs and Telegram client for results.');
    rl.close();
  } catch (error) {
    console.error('Unexpected error:', error);
    rl.close();
  }
}

testIntegration();