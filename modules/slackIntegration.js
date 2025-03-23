// modules/slackIntegration.js
import axios from 'axios';
import crypto from 'crypto';
import config from '../config.js';
import { pendingSlackAcks } from './state.js';
import createLogger from './logger.js';

// Initialize logger
const logger = createLogger('slackIntegration');

/**
 * Send message to Slack with Ack button
 * @param {Object} bot - Telegram bot instance
 * @param {string} message - Message text to forward
 * @param {string} forwarder - Username of the person forwarding
 * @param {Object} contextInfo - Information about the forwarded message
 * @param {number} messageId - Telegram message ID
 * @param {number} chatId - Telegram chat ID
 * @returns {Promise<string>} - Timestamp of the Slack message
 */
export async function sendToSlack(bot, message, forwarder, contextInfo, messageId, chatId) {
  // Prepare source and context information
  let sourceText = '';
  let context = '';
  
  if (typeof contextInfo === 'string') {
    // Legacy support
    context = contextInfo;
  } else if (contextInfo && typeof contextInfo === 'object') {
    if (contextInfo.source) sourceText = contextInfo.source;
    if (contextInfo.context) context = contextInfo.context;
  }
  
  logger.info(`Forwarding message to Slack from ${forwarder}`, { 
    sourceText, 
    chatId
  });
  
  // Create a unique ID for this message
  const forwardId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  
  // Build Slack message with clear sections
  const slackBlocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📢 *Forwarded Message*\n\n${sourceText ? `*Source:* ${sourceText}\n` : ''}*Forwarded by:* ${forwarder}${context ? `\n*Context:*\n${context}` : ''}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Message:*\n${message}`
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
          value: `ack_${forwardId}`
        }
      ]
    }
  ];
  
  // Text fallback for notifications
  const textFallback = `📢 Forwarded Message\n\n${sourceText ? `Source: ${sourceText}\n` : ''}Forwarded by: ${forwarder}\n${context ? `Context: ${context}\n` : ''}Message: ${message}`;
  
  const payload = {
    channel: config.SLACK_CHANNEL_ID,
    text: textFallback,
    blocks: slackBlocks
  };

  try {
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
    logger.info(`Message sent to Slack successfully`, { messageTs, forwardId });
    
    // Critical debugging - Log the state of pendingSlackAcks before storing
    logger.debug('Current pendingSlackAcks state before adding new pending ack:', {
      size: pendingSlackAcks.size,
      keys: Array.from(pendingSlackAcks.keys())
    });
    
    // Store pending Ack info
    pendingSlackAcks.set(messageTs, {
      telegramChatId: chatId,
      telegramMessageId: messageId,
      forwarder,
      timestamp: Date.now()
    });
    
    // Verify the pending ack was stored
    logger.debug('pendingSlackAcks after storing:', {
      size: pendingSlackAcks.size,
      hasKey: pendingSlackAcks.has(messageTs),
      keys: Array.from(pendingSlackAcks.keys())
    });
    
    // Send initial status message to Telegram
    const statusMsg = await bot.telegram.sendMessage(
      chatId,
      "Message forwarded to Slack - status will update upon Ack from the team."
    );
    
    // Save the status message ID for later updates
    const pendingInfo = pendingSlackAcks.get(messageTs);
    if (pendingInfo) {
      pendingInfo.statusMessageId = statusMsg.message_id;
      pendingSlackAcks.set(messageTs, pendingInfo);
      
      // More debug logging
      logger.debug('Updated pendingSlackAcks with status message ID:', {
        messageTs,
        statusMessageId: statusMsg.message_id,
        pendingInfo: pendingSlackAcks.get(messageTs)
      });
    }

    return messageTs;
  } catch (error) {
    logger.error('Error sending to Slack:', error.response?.data || error);
    throw error;
  }
}

/**
 * Send Ack notification back to Telegram
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Telegram chat ID
 * @param {string} message - Message text to send
 * @param {number} statusMessageId - Optional ID of status message to update
 * @returns {Promise} - Telegram sendMessage promise
 */
export async function sendTgAck(bot, chatId, message, statusMessageId = null) {
  logger.info(`Sending Ack to Telegram`, { chatId, message, updateExisting: !!statusMessageId });
  
  try {
    if (statusMessageId) {
      // Try to update existing status message
      return await bot.telegram.editMessageText(
        chatId, 
        statusMessageId, 
        undefined, 
        message
      );
    } else {
      // Send as new message
      return await bot.telegram.sendMessage(chatId, message);
    }
  } catch (error) {
    logger.error(`Error ${statusMessageId ? 'updating' : 'sending'} Telegram message:`, error);
    // Fallback to sending a new message if editing fails
    if (statusMessageId) {
      return await bot.telegram.sendMessage(chatId, message);
    }
    throw error;
  }
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
    logger.warn('🟡️ Slack signing secret not configured. Skipping validation in development mode.');
    return true;
  }
  
  if (!slackSigningSecret) {
    logger.error('🔴 Slack signing secret not configured.');
    return false;
  }
  
  const slackSignature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  
  // raw request body as set by middleware
  const body = req.rawBody;
  
  if (!slackSignature || !timestamp || !body) {
    logger.error('🔴 Missing Slack headers or body:', { 
      hasSignature: !!slackSignature, 
      hasTimestamp: !!timestamp,
      hasBody: !!body
    });
    return false;
  }
  
  // check timestamp for safety
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 300) {
    logger.error('🔴 Request timestamp too old:', { 
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
  
  logger.debug('Signature validation', {
    expected: signature.substring(0, 10) + '...',
    received: slackSignature.substring(0, 10) + '...'
  });
  
  // Use constant-time comparison
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(slackSignature)
    );
    
    if (!isValid) {
      logger.error('🔴 Invalid signature');
    } else {
      logger.debug('🟢 Signature validation successful');
    }
    
    return isValid;
  } catch (e) {
    logger.error('🔴 Error validating signature:', e);
    return false;
  }
}

/**
 * Handle Slack Ack button clicks
 * @param {Object} bot - Telegram bot instance
 * @param {Object} payload - Slack interaction payload
 * @returns {boolean} - Whether Ack was handled
 */
// In slackIntegration.js, update the handleSlackAck function

export async function handleSlackAck(bot, payload) {
  try {
    // Check if this is our acknowledge button
    const action = payload.actions && payload.actions[0];
    
    // Log the entire payload for debugging
    logger.debug('Full Slack payload received', JSON.stringify(payload, null, 2));
    
    logger.info('Processing Ack payload', { 
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
      
      logger.info(`Ack received from ${userName}`, { messageTs, userId });
      
      // Debug dump of ALL pending Acks
      logger.debug('Current pendingSlackAcks state', { 
        size: pendingSlackAcks.size,
        keys: Array.from(pendingSlackAcks.keys()),
        containsKey: pendingSlackAcks.has(messageTs),
        exactKeyToCheck: messageTs
      });
      
      // Regular (non-test) Ack processing
      if (pendingSlackAcks.has(messageTs)) {
        const pendingInfo = pendingSlackAcks.get(messageTs);
        logger.debug('Found pending ack info', pendingInfo);
        
        try {
          // Format timestamp for the message
          const ackTime = new Date().toLocaleString();
          
          // Send Ack back to Telegram
          try {
            if (pendingInfo.statusMessageId) {
              // Try to update existing status message
              await bot.telegram.editMessageText(
                pendingInfo.telegramChatId,
                pendingInfo.statusMessageId,
                undefined,
                `🟢 Your forwarded message has been acknowledged by ${userName} at ${ackTime}.`
              );
              logger.info('Successfully updated existing status message with Ack');
            } else {
              // Send as new message
              const result = await bot.telegram.sendMessage(
                pendingInfo.telegramChatId,
                `🟢 Your forwarded message has been acknowledged by ${userName} at ${ackTime}.`
              );
              logger.info('Sent new Ack message to Telegram', { messageId: result.message_id });
            }
          } catch (telegramError) {
            logger.error('Error sending Ack to Telegram:', telegramError);
            // Fallback to sending a new message if editing fails
            try {
              const result = await bot.telegram.sendMessage(
                pendingInfo.telegramChatId,
                `🟢 Your forwarded message has been acknowledged by ${userName} at ${ackTime}.`
              );
              logger.info('Sent fallback Ack message to Telegram', { messageId: result.message_id });
            } catch (fallbackError) {
              logger.error('Error sending fallback Ack message:', fallbackError);
            }
          }
          
          // Update the Slack message to show who acknowledged it
          logger.debug('Updating Slack message with Ack');
          await updateSlackMessageWithAck(payload.channel.id, messageTs, payload.message, userId, userName);
          
          // Remove from pending list
          pendingSlackAcks.delete(messageTs);
          logger.info(`Ack processed successfully for message ${messageTs}`);
          return true;
        } catch (error) {
          logger.error('Error processing regular Ack:', error);
          return false;
        }
      } else {
        logger.warn(`No pending Ack found for message ${messageTs}`);
        
        // Try to acknowledge it anyway as a fallback
        try {
          logger.debug('Updating Slack message with Ack (fallback)');
          await updateSlackMessageWithAck(
            payload.channel.id, 
            messageTs, 
            payload.message, 
            userId, 
            userName, 
            true // Mark as fallback
          );
          
          logger.info('Fallback Ack processed successfully');
          return true;
        } catch (error) {
          logger.error('Error updating fallback message in Slack:', error);
          return false;
        }
      }
    } else {
      logger.debug('Not an Ack action', { 
        actionId: action?.action_id,
        actionType: action?.type
      });
    }
  } catch (error) {
    logger.error('Error processing Ack:', error);
  }
  return false;
}

// Helper function to update Slack message with Ack
async function updateSlackMessageWithAck(channelId, messageTs, originalMessage, userId, userName, isFallback = false) {
  // Keep original blocks but remove the action button
  const originalBlocks = originalMessage.blocks || [];
  const updatedBlocks = originalBlocks
    .filter(block => block.type !== 'actions')
    .concat([
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `🟢 Acknowledged by <@${userId}> at ${new Date().toLocaleString()}${isFallback ? ' (no Telegram notification sent)' : ''}`
          }
        ]
      }
    ]);
  
  await axios.post('https://slack.com/api/chat.update', {
    channel: channelId,
    ts: messageTs,
    blocks: updatedBlocks
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
    }
  });
}