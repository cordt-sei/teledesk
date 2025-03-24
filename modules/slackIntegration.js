// modules/slackIntegration.js
import axios from 'axios';
import crypto from 'crypto';
import config from '../config.js';
import { pendingSlackAcks, savePendingAcksToDisk } from './state.js';
import createLogger from './logger.js';

// Initialize logger
const logger = createLogger('slackIntegration');

/**
 * Send message to Slack with reaction-based acknowledgment
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
  
  // Build Slack message with clear sections and reaction instructions
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
      type: "section",
      text: {
        type: "mrkdwn",
        text: `_React with :white_check_mark: or :thumbsup: to acknowledge this message (the sender will be notified)._`
      }
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
    logger.info(`Message sent to Slack successfully`, { messageTs });
    
    // Store pending acknowledgment info with all required data
    const pendingInfo = {
      telegramChatId: chatId,
      telegramMessageId: messageId,
      forwarder,
      timestamp: Date.now()
    };
    
    // Store in the shared Map
    pendingSlackAcks.set(messageTs, pendingInfo);
    
    // Log confirmations to verify storage
    logger.debug('pendingSlackAcks after storing:', {
      size: pendingSlackAcks.size,
      hasKey: pendingSlackAcks.has(messageTs),
      keys: Array.from(pendingSlackAcks.keys()),
      pendingInfo: pendingSlackAcks.get(messageTs)
    });
    
    // Send initial status message to Telegram - this is the only message we need
    const statusMsg = await bot.telegram.sendMessage(
      chatId,
      `Forwarded from ${sourceText}\nMessage forwarded to Slack - status will update when a team member acknowledges it.`
    );
    
    // Update the stored info with the status message ID
    pendingInfo.statusMessageId = statusMsg.message_id;
    pendingSlackAcks.set(messageTs, pendingInfo);
    
    // Save the state to disk immediately
    await savePendingAcksToDisk();
    
    // More debug logging to confirm update
    logger.debug('Updated pendingSlackAcks with status message ID:', {
      messageTs,
      statusMessageId: statusMsg.message_id,
      pendingInfo: pendingSlackAcks.get(messageTs)
    });

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
  
  // Raw request body as set by middleware
  const body = req.rawBody;
  
  if (!slackSignature || !timestamp || !body) {
    logger.error('🔴 Missing Slack headers or body:', { 
      hasSignature: !!slackSignature, 
      hasTimestamp: !!timestamp,
      hasBody: !!body
    });
    return false;
  }
  
  // Check timestamp for safety
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