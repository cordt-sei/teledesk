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
  savePendingAcksToDisk,
  loadPendingAcksFromDisk
} from './modules/state.js';
import { sendTgAck } from './modules/slackIntegration.js';
import { startReactionPolling, checkForReactions } from './modules/slackPolling.js';
import createLogger from './modules/logger.js';
import axios from 'axios';

// Initialize logger
const logger = createLogger('bot');

// Initialize state persistence and load existing acknowledgments
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
    
    logger.debug('Waiting before launch...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Make sure we load existing pending acknowledgments before starting
    logger.info('Loading pending acknowledgments from disk...');
    await loadPendingAcksFromDisk();
    logger.info(`Loaded ${pendingSlackAcks.size} pending acknowledgments`);
    
    logger.info('Starting bot with custom polling parameters...');
    bot.launch({
      polling: {
        timeout: 10,
        limit: 100,
        allowedUpdates: ['message', 'callback_query'],
      },
      dropPendingUpdates: true
    });
    
    logger.info(`Bot is ready (Environment: ${config.DEPLOY_ENV || 'development'})`);
    
    // Start reaction polling immediately after bot has launched
    logger.info('Starting Slack reaction polling system...');
    pollingInterval = startReactionPolling(bot);
    
    if (!pollingInterval) {
      logger.error('Failed to initialize Slack reaction polling - returned null interval');
    } else {
      logger.info('Successfully started reaction polling with interval ID: ' + pollingInterval);
      
      // Force an immediate manual check
      logger.info('Running immediate manual reaction check...');
      try {
        await checkForReactions(bot);
        logger.info('Manual reaction check completed');
      } catch (err) {
        logger.error('Error in manual reaction check:', err);
      }
    }
    
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

// Get user's real name from their user ID
export async function getSlackUserName(userId) {
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

// Add debug command for reaction checking
if (process.env.DEBUG_REACTIONS === 'true') {
  logger.info('Debug mode enabled: adding manual reaction check command');
  bot.command('checkreactions', async (ctx) => {
    logger.info('Manual reaction check command received');
    try {
      await checkForReactions(bot);
      await ctx.reply('Manual reaction check completed');
    } catch (err) {
      logger.error('Error in manual reaction check:', err);
      await ctx.reply('Error in manual reaction check: ' + err.message);
    }
  });
}

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