// tests/webhook-test.js
import axios from 'axios';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper to ask questions
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function testSlackWebhook() {
  try {
    console.log('Slack Webhook Diagnostic Tool');
    console.log('============================');
    
    // Get the webhook URL
    const webhookUrl = process.env.SLACK_WEBHOOK_SERVER || 'http://localhost:3030/slack/interactions';
    console.log(`Using webhook endpoint: ${webhookUrl}`);
    
    // First check if the server is running
    try {
      const baseUrl = webhookUrl.replace('/slack/interactions', '');
      const testUrl = `${baseUrl}/test`;
      console.log(`\nChecking if webhook server is running at ${testUrl}...`);
      
      const testResponse = await axios.get(testUrl, { timeout: 3000 });
      console.log(`✅ Server is running: ${testResponse.data}`);
    } catch (error) {
      console.error(`❌ Server check failed: ${error.message}`);
      if (error.code === 'ECONNREFUSED') {
        console.log('The webhook server is not running. Start it with "yarn dev:webhook"');
      }
      rl.close();
      return;
    }
    
    // Create a mock payload to simulate Slack's interactive message button click
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
      channel: { id: process.env.SLACK_CHANNEL_ID || 'test-channel', name: 'testchannel' },
      message: {
        type: 'message',
        text: 'Test Message',
        ts: `${Date.now() / 1000}`,
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
    
    console.log('\nSending mock Slack button click event...');
    
    try {
      // Send with short timeout to test immediate response
      const response = await axios.post(webhookUrl, payloadStr, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Slack-Request-Timestamp': now.toString(),
          'X-Slack-Signature': 'v0=test_signature' // Not used in dev mode
        },
        timeout: 3000 // Short timeout to test immediate response
      });
      
      console.log(`\n✅ Server responded with status: ${response.status}`);
      
      if (response.status === 200) {
        console.log('The webhook endpoint is responding correctly! Server acknowledged immediately.');
        console.log('This confirms the fix is working - the server now processes the webhook asynchronously.');
      } else {
        console.log(`The server responded with an unexpected status code: ${response.status}`);
      }
    } catch (error) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        console.error('❌ Webhook request timed out after 3 seconds');
        console.log('This indicates the server is not responding quickly enough.');
        console.log('Check that you have implemented the immediate response in the webhook endpoint.');
      } else {
        console.error(`❌ Webhook request failed: ${error.message}`);
      }
    }
    
    rl.close();
  } catch (error) {
    console.error('Unexpected error:', error);
    rl.close();
  }
}

testSlackWebhook();