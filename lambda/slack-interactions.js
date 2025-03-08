import axios from 'axios';
import crypto from 'crypto';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';

// Initialize DynamoDB client for storing/retrieving pending acknowledgments
const dynamoDB = DynamoDBDocument.from(new DynamoDB());
const SLACK_ACKNOWLEDGMENTS_TABLE = process.env.SLACK_ACKNOWLEDGMENTS_TABLE;
const USER_STATES_TABLE = process.env.USER_STATES_TABLE;

// Handler for Slack interactions
export const handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  try {
    // Validate Slack request
    if (!validateSlackRequest(event)) {
      console.error('Invalid Slack request signature');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }
    
    // Parse the payload
    const payload = JSON.parse(event.body.payload || '{}');
    console.log('Parsed payload:', JSON.stringify(payload, null, 2));
    
    // Handle button clicks
    if (payload.type === 'block_actions') {
      const action = payload.actions && payload.actions[0];
      const messageTs = payload.message.ts;
      const userId = payload.user.id;
      const userName = payload.user.username || payload.user.name;
      
      // Handle forward acknowledgment
      if (action && action.action_id === 'acknowledge_forward') {
        console.log(`Acknowledgment received from ${userName} for message ${messageTs}`);
        
        // Get pending acknowledgment from DynamoDB
        const pendingAck = await getPendingAcknowledgment(messageTs);
        
        if (pendingAck) {
          // Send acknowledgment back to Telegram
          try {
            // Send message to Telegram via API (since we can't access the bot instance directly)
            await axios.post(
              `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
              {
                chat_id: pendingAck.telegramChatId,
                text: `✅ Your forwarded message has been acknowledged by ${userName} in Slack.`
              }
            );
            
            // Update the Slack message to show who acknowledged it
            await axios.post('https://slack.com/api/chat.update', {
              channel: payload.channel.id,
              ts: messageTs,
              text: payload.message.text + `\n\n✅ Acknowledged by <@${userId}>`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: payload.message.text
                  }
                },
                {
                  type: "context",
                  elements: [
                    {
                      type: "mrkdwn",
                      text: `✅ Acknowledged by <@${userId}> at ${new Date().toLocaleString()}`
                    }
                  ]
                }
              ]
            }, {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SLACK_API_TOKEN}`
              }
            });
            
            // Remove from pending list
            await removePendingAcknowledgment(messageTs);
            console.log(`Acknowledgment processed successfully for message ${messageTs}`);
          } catch (error) {
            console.error('Error processing acknowledgment:', error);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to process acknowledgment' }) };
          }
        } else {
          console.log(`No pending acknowledgment found for message ${messageTs}`);
        }
      }
      
      // Handle group request
      if (action && action.action_id === 'handle_group_request') {
        console.log(`Group request being handled by ${userName}`);
        
        // Update the Slack message to show who's handling it
        try {
          await axios.post('https://slack.com/api/chat.update', {
            channel: payload.channel.id,
            ts: messageTs,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: payload.message.text
                }
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `✅ Being handled by <@${userId}> since ${new Date().toLocaleString()}`
                  }
                ]
              }
            ]
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.SLACK_API_TOKEN}`
            }
          });
        } catch (error) {
          console.error('Error updating group request message:', error);
          return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update group request' }) };
        }
      }
    }
    
    // Always acknowledge receipt of the interaction to Slack
    return {
      statusCode: 200,
      body: '',
    };
  } catch (error) {
    console.error('Error processing Slack webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

// Validate Slack requests
function validateSlackRequest(event) {
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  
  // Skip validation in dev mode if secret not configured
  if (!slackSigningSecret && process.env.DEPLOY_ENV !== 'production') {
    console.warn('Slack signing secret not configured. Skipping validation in development mode.');
    return true;
  }
  
  if (!slackSigningSecret) {
    console.error('Slack signing secret not configured.');
    return false;
  }
  
  const slackSignature = event.headers['x-slack-signature'];
  const timestamp = event.headers['x-slack-request-timestamp'];
  const body = event.body;
  
  if (!slackSignature || !timestamp) {
    console.error('Missing Slack headers:', {
      hasSignature: !!slackSignature,
      hasTimestamp: !!timestamp
    });
    return false;
  }
  
  // Check if timestamp is recent (prevent replay attacks)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 300) {
    console.error('Request timestamp too old:', {
      requestTime: timestamp,
      currentTime,
      difference: Math.abs(currentTime - timestamp)
    });
    return false;
  }
  
  // Generate our own signature
  const sigBaseString = `v0:${timestamp}:${body}`;
  const signature = 'v0=' + crypto
    .createHmac('sha256', slackSigningSecret)
    .update(sigBaseString)
    .digest('hex');
  
  // Use safer string comparison
  if (signature.length !== slackSignature.length) {
    return false;
  }
  
  // Constant time comparison to prevent timing attacks
  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ slackSignature.charCodeAt(i);
  }
  
  return result === 0;
}

// DynamoDB functions for storing/retrieving acknowledgments
async function getPendingAcknowledgment(messageTs) {
  try {
    const result = await dynamoDB.get({
      TableName: SLACK_ACKNOWLEDGMENTS_TABLE,
      Key: { messageTs: messageTs }
    });
    return result.Item;
  } catch (error) {
    console.error('Error getting pending acknowledgment:', error);
    return null;
  }
}

async function savePendingAcknowledgment(messageTs, telegramChatId, telegramMessageId, forwarder) {
  try {
    const expirationTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days TTL
    await dynamoDB.put({
      TableName: SLACK_ACKNOWLEDGMENTS_TABLE,
      Item: {
        messageTs: messageTs,
        telegramChatId: telegramChatId,
        telegramMessageId: telegramMessageId,
        forwarder: forwarder,
        timestamp: Date.now(),
        expirationTime: expirationTime
      }
    });
  } catch (error) {
    console.error('Error saving pending acknowledgment:', error);
    throw error;
  }
}

async function removePendingAcknowledgment(messageTs) {
  try {
    await dynamoDB.delete({
      TableName: SLACK_ACKNOWLEDGMENTS_TABLE,
      Key: { messageTs: messageTs }
    });
  } catch (error) {
    console.error('Error removing pending acknowledgment:', error);
    throw error;
  }
}