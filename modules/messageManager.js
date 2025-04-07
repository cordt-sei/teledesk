// modules/messageManager.js
import { lastBotMessages } from './state.js';
import createLogger from './logger.js';

// Initialize logger
const logger = createLogger('messageManager');

// Track user message IDs to clean up commands
const userMessageIds = new Map();

/**
 * Manages sending and updating bot messages
 */
class MessageManager {
  /**
   * Clear previous bot messages and store new message ID for future cleanup
   * @param {number} chatId - Telegram chat ID
   * @param {Object} bot - Telegram bot instance
   * @param {Object} ctx - Optional Telegram context for cleaning up user commands
   * @returns {Promise<void>}
   */
  static async clearPreviousMessages(chatId, bot, ctx = null) {
    // Try to clean up the user's command message if provided in context
    if (ctx && ctx.message && ctx.message.message_id) {
      try {
        await bot.telegram.deleteMessage(chatId, ctx.message.message_id);
        logger.debug(`Deleted user command message ${ctx.message.message_id}`);
      } catch (error) {
        // Ignore errors for message deletion (might be too old or already deleted)
        logger.debug(`Could not delete user message ${ctx.message.message_id}: ${error.message}`);
      }
    }
    
    // Delete previous bot messages for this chat
    const previousMessages = lastBotMessages.get(chatId);
    
    if (previousMessages && previousMessages.length > 0) {
      // Delete previous menus/prompts to avoid cluttering the chat
      for (const msgId of previousMessages) {
        try {
          await bot.telegram.deleteMessage(chatId, msgId);
          logger.debug(`Deleted previous bot message ${msgId}`);
        } catch (error) {
          // Ignore errors for message deletion (might be too old or already deleted)
          logger.debug(`Could not delete message ${msgId}: ${error.message}`);
        }
      }
    }
    
    // Clear stored messages for this chat
    lastBotMessages.delete(chatId);
    
    // Also clear stored user message IDs
    userMessageIds.delete(chatId);
  }
  
  /**
   * Send a new bot message and store its ID for future management
   * @param {number} chatId - Telegram chat ID
   * @param {string} text - Message text
   * @param {Object} options - Telegram message options (markdown, keyboard, etc.)
   * @param {Object} bot - Telegram bot instance
   * @returns {Promise<Object>} The sent message
   */
  static async sendMessage(chatId, text, options, bot) {
    const message = await bot.telegram.sendMessage(chatId, text, options);
    
    // Store the message ID for future cleanup
    if (message && message.message_id) {
      const messageIds = lastBotMessages.get(chatId) || [];
      messageIds.push(message.message_id);
      lastBotMessages.set(chatId, messageIds);
      
      logger.debug(`Stored bot message ID ${message.message_id} for chat ${chatId}`);
    }
    
    return message;
  }
  
  /**
   * Update an existing message instead of sending a new one
   * @param {number} chatId - Telegram chat ID
   * @param {number} messageId - ID of message to update
   * @param {string} text - New message text
   * @param {Object} options - Telegram message options
   * @param {Object} bot - Telegram bot instance
   * @returns {Promise<Object>} The updated message
   */
  static async updateMessage(chatId, messageId, text, options, bot) {
    try {
      const message = await bot.telegram.editMessageText(
        chatId,
        messageId,
        null, // inline_message_id
        text,
        options
      );
      
      logger.debug(`Updated bot message ${messageId} for chat ${chatId}`);
      return message;
    } catch (error) {
      // If updating fails (e.g., message too old), send a new message
      logger.debug(`Failed to update message ${messageId}, sending new: ${error.message}`);
      return await this.sendMessage(chatId, text, options, bot);
    }
  }
  
  /**
   * Track user message ID for potential cleanup
   * @param {Object} ctx - Telegram context with message
   */
  static trackUserMessage(ctx) {
    if (ctx && ctx.message && ctx.chat) {
      const chatId = ctx.chat.id;
      const messageId = ctx.message.message_id;
      
      const messageIds = userMessageIds.get(chatId) || [];
      messageIds.push(messageId);
      
      // Only keep the last 10 messages to avoid memory buildup
      if (messageIds.length > 10) {
        messageIds.shift();
      }
      
      userMessageIds.set(chatId, messageIds);
      logger.debug(`Tracked user message ${messageId} for chat ${chatId}`);
    }
  }
  
  /**
   * Delete a specific user message if possible
   * @param {number} chatId - Telegram chat ID
   * @param {number} messageId - Message ID to delete
   * @param {Object} bot - Telegram bot instance
   */
  static async deleteUserMessage(chatId, messageId, bot) {
    try {
      await bot.telegram.deleteMessage(chatId, messageId);
      
      // Update the tracked messages
      const messageIds = userMessageIds.get(chatId) || [];
      const updatedIds = messageIds.filter(id => id !== messageId);
      userMessageIds.set(chatId, updatedIds);
      
      logger.debug(`Deleted user message ${messageId} for chat ${chatId}`);
    } catch (error) {
      logger.debug(`Could not delete user message ${messageId}: ${error.message}`);
    }
  }
  
  /**
   * Attempt to delete recent user messages to clean up the chat
   * @param {number} chatId - Telegram chat ID 
   * @param {Object} bot - Telegram bot instance
   * @param {number} count - Number of recent messages to try deleting
   */
  static async cleanupRecentUserMessages(chatId, bot, count = 3) {
    const messageIds = userMessageIds.get(chatId) || [];
    const recentIds = messageIds.slice(-count);
    
    for (const messageId of recentIds) {
      await this.deleteUserMessage(chatId, messageId, bot);
    }
  }
}

export default MessageManager;