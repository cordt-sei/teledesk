// bot.js
import { Telegraf } from 'telegraf';
import config from './config.js';
import {
  handleStart,
  handleHelp,
  handleTicketCommand,
  handleStatusCommand,
  handleMessage,
  handleCallbackQuery
} from './modules/messageHandlers.js';
import { 
  pendingSlackAcks, 
  initializeState, 
  setupShutdownHandlers,
  savePendingAcksToDisk
} from './modules/state.js';
import { sendTgAck } from './modules/slackIntegration.js';
import createLogger from './modules/logger.js';
import axios from 'axios';

// Initialize logger
const logger = createLogger('bot');

// Initialize state persistence
initializeState();
setupShutdownHandlers();

// Initialize the bot
const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

// Add error handler for bot
bot.catch((err, ctx) => {
  logger.error(`Error in bot context: ${err}`, {
    update: ctx.update,
    error: err
  });
});

// Register command handlers
bot.start(ctx => {
  logger.info('Start command received', { 
    userId: ctx.from?.id,
    username: ctx.from?.username || ctx.from?.first_name 
  });
  return handleStart(ctx, bot);
});

bot.help(ctx => {
  logger.info('Help command received', { userId: ctx.from?.id });
  return handleHelp(ctx, bot);
});

bot.command('ticket', ctx => {
  logger.info('Ticket command received', { userId: ctx.from?.id });
  return handleTicketCommand(ctx, bot);
});

bot.command('status', ctx => {
  logger.info('Status command received', { userId: ctx.from?.id });
  return handleStatusCommand(ctx, bot);
});

bot.command('menu', ctx => {
  logger.info('Menu command received', { userId: ctx.from?.id });
  return handleStart(ctx, bot); // Use start handler for menu command
});

// Register message handler
bot.on('message', ctx => {
  logger.info('Message received', { 
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
    messageType: ctx.message.text ? 'text' : 'non-text',
    isForwarded: !!(ctx.message.forward_from || ctx.message.forward_from_chat || ctx.message.forward_sender_name || ctx.message.forward_date)
  });
  return handleMessage(ctx, bot);
});

// Register callback query handler (button clicks)
bot.on('callback_query', ctx => {
  logger.info('Callback query received', { 
    userId: ctx.from?.id,
    data: ctx.callbackQuery?.data 
  });
  return handleCallbackQuery(ctx, bot);
});

// Store reference to polling interval for cleanup
let pollingInterval;

// Bot initialization
async function startBot() {
  try {
    logger.info('Clearing webhook and pending updates...');
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    
    logger.debug('Waiting before launch...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    logger.info('Starting bot with custom polling parameters...');
    await bot.launch({
      polling: {
        timeout: 10,
        limit: 100,
        allowedUpdates: ['message', 'callback_query'],
      },
      dropPendingUpdates: true
    });
    
    // Start reaction polling after bot has launched
    logger.info('Starting reaction polling system...');
    pollingInterval = startReactionPolling(bot);
    
    logger.info(`Bot is ready (Environment: ${config.DEPLOY_ENV || 'development'})`);
    
    // Signal ready to PM2
    if (process.send) {
      process.send('ready');
      logger.info('Sent ready signal to process manager');
    }
  } catch (err) {
    logger.error('Failed to start bot:', err);
    // Exit with error code so PM2 can restart
    process.exit(1);
  }
}

// Implement the polling function directly in bot.js to avoid import issues
function startReactionPolling(bot) {
  logger.info('Starting Slack reaction polling...');

  // Run once on startup with a small delay to ensure everything is initialized
  setTimeout(() => {
    checkForReactions(bot).catch(error => {
      logger.error('Error in initial reaction check:', error);
    });
  }, 5000);
  
  // Set up interval for periodic checking
  const interval = setInterval(async () => {
    try {
      await checkForReactions(bot);
    } catch (error) {
      logger.error('Error in reaction polling:', error);
    }
  }, 15000); // Check every 15 seconds
  
  return interval;
}

// Check for reactions on all pending messages
async function checkForReactions(bot) {
  const pendingCount = pendingSlackAcks.size;
  logger.info(`Running reaction check cycle, pendingAcks size: ${pendingCount}`);
  
  if (pendingCount === 0) {
    return; // Nothing to check
  }
  
  // Debug log all pending messages
  logger.debug('Current pending acknowledgments:', 
    Array.from(pendingSlackAcks.entries()).map(([key, val]) => 
      `${key}: chatId=${val.telegramChatId}, statusMsgId=${val.statusMessageId || 'N/A'}`
    )
  );
  
  // Get all pending message timestamps
  const pendingMessageTimestamps = Array.from(pendingSlackAcks.keys());
  
  for (const messageTs of pendingMessageTimestamps) {
    try {
      // Skip if already processed
      if (!pendingSlackAcks.has(messageTs)) continue;
      
      const pendingInfo = pendingSlackAcks.get(messageTs);
      
      // Skip messages older than the max age (7 days)
      const MAX_POLLING_AGE_MS = 7 * 24 * 60 * 60 * 1000;
      const messageAge = Date.now() - pendingInfo.timestamp;
      if (messageAge > MAX_POLLING_AGE_MS) {
        logger.info(`Message ${messageTs} is too old (${Math.round(messageAge/86400000)} days), removing from polling`);
        pendingSlackAcks.delete(messageTs);
        await savePendingAcksToDisk();
        continue;
      }
      
      logger.debug(`Checking reactions for message ${messageTs} in channel ${config.SLACK_CHANNEL_ID}`);
      
      // Get reactions for this message using axios directly
      const reactions = await getMessageReactions(config.SLACK_CHANNEL_ID, messageTs);
      
      if (reactions.length > 0) {
        logger.debug(`Found ${reactions.length} reactions:`, reactions.map(r => r.name).join(', '));
      } else {
        logger.debug(`No reactions found on message ${messageTs}`);
        continue; // Skip to next message if no reactions
      }
      
      // Check for acknowledgment reactions
      const ackReaction = reactions.find(r => 
        r.name === 'white_check_mark' || 
        r.name === 'check' || 
        r.name === 'heavy_check_mark' || 
        r.name === '+1' ||
        r.name === 'thumbsup' ||
        r.name === 'eye' ||
        r.name === 'eyes'
      );
      
      if (!ackReaction) {
        logger.debug(`No acknowledgment reaction found for message ${messageTs}`);
        continue; // Skip to next message if no acknowledgment reaction
      }
      
      logger.info(`Found acknowledgment reaction for message ${messageTs}`);
      
      // Found an acknowledgment reaction
      let userName = 'Team Member';
      
      // Get the user name if possible
      if (ackReaction.users && ackReaction.users.length > 0) {
        try {
          const user = await getUserName(ackReaction.users[0]);
          userName = user || 'Team Member';
        } catch (error) {
          logger.error(`Error getting user name: ${error.message}`);
        }
      }
      
      const ackTime = new Date().toLocaleString();
      const ackMessage = `🟢 Your forwarded message has been acknowledged by ${userName} at ${ackTime}.`;
      
      // Send ack to Telegram
      try {
        const chatId = pendingInfo.telegramChatId;
        logger.info(`Sending acknowledgment to Telegram chat ID ${chatId}`);
        
        if (pendingInfo.statusMessageId) {
          logger.info(`Updating status message ${pendingInfo.statusMessageId}`);
          
          try {
            // Direct API call to edit message
            await bot.telegram.editMessageText(
              chatId,
              pendingInfo.statusMessageId,
              null, // inline message id
              ackMessage
            );
            logger.info(`Successfully updated status message ${pendingInfo.statusMessageId}`);
          } catch (editError) {
            logger.error(`Error updating status message: ${editError.message}`);
            // Fall back to sending a new message
            await bot.telegram.sendMessage(chatId, ackMessage);
            logger.info(`Sent fallback message to chat ${chatId}`);
          }
        } else {
          // No status message ID, send as new message
          logger.info(`No status message ID, sending as new message to chat ${chatId}`);
          await bot.telegram.sendMessage(chatId, ackMessage);
        }
        
        logger.info(`Acknowledged message ${messageTs} by ${userName}`);
        
        // Remove from pending list
        pendingSlackAcks.delete(messageTs);
        await savePendingAcksToDisk();
        logger.info(`Removed message ${messageTs} from pending acks, ${pendingSlackAcks.size} remaining`);
      } catch (error) {
        logger.error(`Error sending ack to Telegram for message ${messageTs}:`, error);
      }
    } catch (error) {
      logger.error(`Error checking reactions for message ${messageTs}:`, error);
    }
  }
}

// Get reactions for a specific message
async function getMessageReactions(channelId, messageTs) {
  try {
    const url = `https://slack.com/api/reactions.get?channel=${encodeURIComponent(channelId)}&timestamp=${encodeURIComponent(messageTs)}`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
      }
    });
    
    if (!response.data.ok) {
      if (response.data.error === 'message_not_found') {
        logger.debug(`Message ${messageTs} not found in channel ${channelId}`);
        return [];
      }
      
      if (response.data.error === 'missing_scope') {
        logger.error(`Missing required scope for reactions.get API: ${response.data.error}`);
        logger.error('Make sure your Slack app has the reactions:read scope');
        return [];
      }
      
      logger.error(`Slack API error getting reactions: ${response.data.error}`);
      return [];
    }
    
    // Extract reactions according to the API structure
    if (response.data.message && response.data.message.reactions) {
      return response.data.message.reactions;
    }
    
    return [];
  } catch (error) {
    logger.error('Error getting message reactions:', error);
    return [];
  }
}

// Get user's real name from their user ID
async function getUserName(userId) {
  try {
    const response = await axios.get(
      `https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`,
      {
        headers: {
          'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
        }
      }
    );
    
    if (!response.data.ok) {
      logger.error(`Slack API error getting user info: ${response.data.error}`);
      return 'Team Member';
    }
    
    return response.data.user.real_name || response.data.user.name || 'Team Member';
  } catch (error) {
    logger.error('Error getting user info:', error);
    return 'Team Member';
  }
}

// Improved shutdown handling
function handleShutdown(signal) {
  return async () => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    // Stop the polling interval
    if (pollingInterval) {
      clearInterval(pollingInterval);
      logger.info('Reaction polling stopped');
    }
    
    // Save any pending acknowledgments
    try {
      await savePendingAcksToDisk();
      logger.info('Saved pending acknowledgments');
    } catch (err) {
      logger.error('Error saving pending acks:', err);
    }
    
    // Stop the bot gracefully
    try {
      bot.stop(signal);
      logger.info('Bot stopped successfully');
    } catch (err) {
      logger.error('Error stopping bot:', err);
    }
    
    // Allow some time for cleanup before exiting
    setTimeout(() => {
      logger.info('Clean shutdown complete');
      process.exit(0);
    }, 1000);
  };
}

// Process uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception in bot process', err);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection in bot process', { reason, promise });
});

// Only start the bot when explicitly enabled
if (process.env.BOT_PROCESS === 'true') {
  logger.info('Starting bot process');
  startBot();
} else {
  logger.info('Bot not started (BOT_PROCESS != true)');
}

// Improved shutdown handlers
process.once('SIGINT', handleShutdown('SIGINT'));
process.once('SIGTERM', handleShutdown('SIGTERM'));

export { bot, pendingSlackAcks, sendTgAck };
export default bot;