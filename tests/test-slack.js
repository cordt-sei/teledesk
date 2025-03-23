// tests/test-slack.js
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';
import createLogger from '../modules/logger.js';

dotenv.config();

const logger = createLogger('slackTester');

async function testSlackAck() {
  try {
    // Load environment variables
    const slackToken = process.env.SLACK_API_TOKEN;
    const webhookUrl = process.env.SLACK_WEBHOOK_SERVER || 'http://localhost:3030/slack/interactions';
    const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
    
    if (!slackToken) {
      logger.error('SLACK_API_TOKEN is not set in environment');
      process.exit(1);
    }
    
    // First, create a mock message in Slack
    logger.info('Creating a test message in Slack...');
    const channelId = process.env.SLACK_CHANNEL_ID;
    
    const response = await axios.post('https://slack.com/api/chat.postMessage', {
      channel: channelId,
      text: "🧪 *TEST MESSAGE* 🧪\n\nThis is an automated test of the Slack Ack system.",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🧪 *TEST MESSAGE* 🧪\n\nThis is an automated test of the Slack Ack system."
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
    }, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${slackToken}`
      }
    });
    
    if (!response.data.ok) {
      logger.error('Failed to create test message in Slack', response.data);
      process.exit(1);
    }
    
    const messageTs = response.data.ts;
    logger.info(`Test message created with timestamp: ${messageTs}`);
    
    // Now simulate a button click by sending a webhook to our server
    logger.info('Simulating button click by sending webhook...');
    
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
      channel: { id: channelId, name: 'testchannel' },
      message: {
        type: 'message',
        text: '🧪 *TEST MESSAGE* 🧪\n\nThis is an automated test of the Slack Ack system.',
        ts: messageTs,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🧪 *TEST MESSAGE* 🧪\n\nThis is an automated test of the Slack Ack system.'
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
    
    // Create a signature using the signing secret
    let signature;
    if (slackSigningSecret) {
      const sigBaseString = `v0:${now}:${payloadStr}`;
      signature = 'v0=' + crypto
        .createHmac('sha256', slackSigningSecret)
        .update(sigBaseString)
        .digest('hex');
    } else {
      logger.warn('SLACK_SIGNING_SECRET not set, skipping signature creation');
      signature = 'v0=no_secret';
    }
    
    logger.debug('Sending webhook request to: ' + webhookUrl);
    logger.debug('Webhook payload:', {
      payload: mockPayload.type,
      contentType: 'application/x-www-form-urlencoded',
      timestamp: now.toString(),
      hasSignature: !!signature
    });
    
    try {
      // Use a timeout to ensure we don't wait forever
      const webhookResponse = await axios.post(webhookUrl, payloadStr, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Slack-Request-Timestamp': now.toString(),
          'X-Slack-Signature': signature
        },
        validateStatus: null, // Don't throw on any status code
        timeout: 5000 // 5 second timeout
      });
      
      logger.info('Webhook response:', {
        status: webhookResponse.status,
        statusText: webhookResponse.statusText,
        data: webhookResponse.data
      });
      
      // Give the server a moment to process the webhook
      logger.info('Waiting for server to process request...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Clean up the test message
      logger.info('Cleaning up test message...');
      const deleteResponse = await axios.post('https://slack.com/api/chat.delete', {
        channel: channelId,
        ts: messageTs
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${slackToken}`
        }
      });
      
      if (deleteResponse.data.ok) {
        logger.info('Test message deleted successfully');
      } else {
        logger.warn('Failed to delete test message', deleteResponse.data);
      }
      
      logger.info('Test completed! Check the server logs to see if Ack was processed correctly.');
      
      if (webhookResponse.status !== 200) {
        logger.warn('Webhook received a non-200 response code. This might indicate an issue with the server.');
      } else {
        logger.info('Webhook received a 200 response. This is good!');
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        logger.error(`Webhook server not reachable at ${webhookUrl}. Make sure it's running.`);
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
        logger.error(`Webhook request timed out. The server might be slow to respond.`);
      } else {
        logger.error('Error sending webhook:', error.message);
      }
      
      // Clean up the test message even if the webhook failed
      try {
        logger.info('Cleaning up test message (after error)...');
        await axios.post('https://slack.com/api/chat.delete', {
          channel: channelId,
          ts: messageTs
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${slackToken}`
          }
        });
      } catch (cleanupError) {
        logger.error('Error cleaning up test message:', cleanupError.message);
      }
      
      process.exit(1);
    }
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
}

// Main function
async function main() {
  logger.info('Starting Slack Ack test...');
  await testSlackAck();
  logger.info('Test complete!');
}

main();