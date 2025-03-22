// modules/slackIntegration.js
import axios from 'axios';
import crypto from 'crypto';
import config from '../config.js';
import { pendingSlackAcknowledgments } from './state.js';
import createLogger from './logger.js';

// Initialize logger
const logger = createLogger('slackIntegration');

/**
 * Send message to Slack with acknowledgment button
 * @param {Object} bot - Telegram bot instance
 * @param {string} message - Message text to forward
 * @param {string} forwarder - Username of the person forwarding
 * @param {string} forwardedFrom - Source of the forwarded message
 * @param {number} messageId - Telegram message ID
 * @param {number} chatId - Telegram chat ID
 * @returns {Promise<string>} - Timestamp of the Slack message
 */
export async function sendToSlack(bot, message, forwarder, forwardedFrom, messageId, chatId) {
  logger.info(`Forwarding message to Slack from ${forwarder}`, { forwardedFrom, chatId });
  
  const payload = {
    channel: config.SLACK_CHANNEL_ID,
    text: `📢 *Forwarded Message*\n\n📌 *From:* ${forwarder}\n🏷 *Group:* ${forwardedFrom || 'Unknown'}\n📝 *Message:* ${message}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📢 *Forwarded Message*\n\n📌 *From:* ${forwarder}\n🏷 *Group:* ${forwardedFrom || 'Unknown'}\n📝 *Message:* ${message}`
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
            value: `ack_${Date.now()}`
          }
        ]
      }
    ]
  };

  try {
    logger.debug('Sending message to Slack API', { channel: config.SLACK_CHANNEL_ID });
    
    const response = await axios.post('https://slack.com/api/chat.postMessage', payload, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
      }
    });
    
    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }
    
    const messageTs = response.data.ts;
    logger.info(`Message sent to Slack successfully`, { messageTs });
    
    // Store pending acknowledgment info
    pendingSlackAcknowledgments.set(messageTs, {
      telegramChatId: chatId,
      telegramMessageId: messageId,
      forwarder,
      timestamp: Date.now()
    });
    
    logger.debug('Stored pending acknowledgment', { 
      messageTs, 
      chatId, 
      pendingCount: pendingSlackAcknowledgments.size 
    });
    
    await bot.telegram.sendMessage(
      chatId,
      "✅ Message forwarded to Slack - status will update upon acknowledgment from the team."
    );

    return messageTs;
  } catch (error) {
    logger.error('Error sending to Slack:', error.response?.data || error);
    throw error;
  }
}

/**
 * Send acknowledgment notification back to Telegram
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Telegram chat ID
 * @param {string} message - Message text to send
 * @returns {Promise} - Telegram sendMessage promise
 */
export function sendTelegramAcknowledgment(bot, chatId, message) {
  logger.info(`Sending acknowledgment to Telegram`, { chatId, message });
  return bot.telegram.sendMessage(chatId, message);
}

/**
 * Validate that a Slack webhook request is genuine
 * @param {Object} req - Express request object
 * @param {string} slackSigningSecret - Slack signing secret
 * @returns {boolean} - Whether the request is valid
 */
export function validateSlackRequest(req, slackSigningSecret) {
  logger.debug('Validating Slack request');
  
  // If no signing secret is configured, skip validation in development
  if (!slackSigningSecret && config.DEPLOY_ENV !== 'production') {
    logger.warn('⚠️ Slack signing secret not configured. Skipping validation in development mode.');
    return true;
  }
  
  if (!slackSigningSecret) {
    logger.error('❌ Slack signing secret not configured.');
    return false;
  }
  
  const slackSignature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  const body = req.rawBody || JSON.stringify(req.body);
  
  if (!slackSignature || !timestamp) {
    logger.error('❌ Missing Slack headers:', { 
      hasSignature: !!slackSignature, 
      hasTimestamp: !!timestamp 
    });
    return false;
  }
  
  // Check if timestamp is recent (prevent replay attacks)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 300) {
    logger.error('❌ Request timestamp too old:', { 
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
  
  // Use constant-time comparison
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(slackSignature)
    );
    
    if (!isValid) {
      logger.error('❌ Invalid signature');
    } else {
      logger.debug('✅ Signature validation successful');
    }
    
    return isValid;
  } catch (e) {
    logger.error('❌ Error validating signature:', e);
    return false;
  }
}

/**
 * Handle Slack acknowledgment button clicks
 * @param {Object} bot - Telegram bot instance
 * @param {Object} payload - Slack interaction payload
 * @returns {boolean} - Whether acknowledgment was handled
 */
export async function handleSlackAcknowledgment(bot, payload) {
  try {
    // Check if this is our acknowledge button
    const action = payload.actions && payload.actions[0];
    
    // Log the entire payload for full debugging 
    logger.debug('Slack payload received', JSON.stringify(payload, null, 2));
    
    logger.debug('Processing acknowledgment payload', { 
      actionId: action?.action_id,
      messageTs: payload.message?.ts,
      user: payload.user?.name || payload.user?.username,
      channelId: payload.channel?.id
    });
    
    // Special handling for test messages
    if (action && action.action_id === 'acknowledge_forward') {
      const messageTs = payload.message.ts;
      const userId = payload.user.id;
      const userName = payload.user.username || payload.user.name;
      
      logger.info(`Acknowledgment received from ${userName}`, { messageTs, userId });
      
      // Log current pendingSlackAcknowledgments state
      logger.debug('Current pending acknowledgments', { 
        keys: [...pendingSlackAcknowledgments.keys()],
        size: pendingSlackAcknowledgments.size
      });
      
      // Special case for test messages
      if (payload.actions[0]?.value?.startsWith('test_ack_')) {
        logger.info('Test acknowledgment detected');
        
        // For test messages, we don't have a real pending acknowledgment
        // Just update the Slack message to show it was acknowledged
        try {
          logger.debug('Updating test Slack message with acknowledgment');
          await axios.post('https://slack.com/api/chat.update', {
            channel: payload.channel.id,
            ts: messageTs,
            text: payload.message.text + `\n\n✅ TEST ACKNOWLEDGED by <@${userId}>`,
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
                    text: `✅ TEST ACKNOWLEDGED by <@${userId}> at ${new Date().toLocaleString()}`
                  }
                ]
              }
            ]
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
            }
          });
          
          logger.info('Test acknowledgment processed successfully');
          return true;
        } catch (error) {
          logger.error('Error updating test message in Slack:', error);
          return false;
        }
      }
      
      // Regular (non-test) acknowledgment processing
      if (pendingSlackAcknowledgments.has(messageTs)) {
        const pendingInfo = pendingSlackAcknowledgments.get(messageTs);
        logger.debug('Found pending info', pendingInfo);
        
        try {
          // Send acknowledgment back to Telegram
          await sendTelegramAcknowledgment(
            bot,
            pendingInfo.telegramChatId,
            `✅ Your forwarded message has been acknowledged by ${userName} in Slack.`
          );
          
          // Update the Slack message to show who acknowledged it
          logger.debug('Updating Slack message with acknowledgment');
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
              'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
            }
          });
          
          // Remove from pending list
          pendingSlackAcknowledgments.delete(messageTs);
          logger.info(`Acknowledgment processed successfully for message ${messageTs}`);
          return true;
        } catch (error) {
          logger.error('Error processing regular acknowledgment:', error);
          return false;
        }
      } else {
        logger.warn(`No pending acknowledgment found for message ${messageTs}`);
        
        // Try to acknowledge it anyway as a fallback
        try {
          logger.debug('Updating Slack message with acknowledgment (fallback)');
          await axios.post('https://slack.com/api/chat.update', {
            channel: payload.channel.id,
            ts: messageTs,
            text: payload.message.text + `\n\n✅ Acknowledged by <@${userId}> (no pending info found)`,
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
                    text: `✅ Acknowledged by <@${userId}> at ${new Date().toLocaleString()} (no Telegram notification sent)`
                  }
                ]
              }
            ]
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
            }
          });
          
          logger.info('Fallback acknowledgment processed successfully');
          return true;
        } catch (error) {
          logger.error('Error updating fallback message in Slack:', error);
          return false;
        }
      }
    } else {
      logger.debug('Not an acknowledgment action', { 
        actionId: action?.action_id,
        actionType: action?.type
      });
    }
  } catch (error) {
    logger.error('Error processing acknowledgment:', error);
  }
  return false;
}