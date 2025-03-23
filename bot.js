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
import { pendingSlackAcks } from './modules/state.js';
import { sendTgAck } from './modules/slackIntegration.js';
import createLogger from './modules/logger.js';

// Initialize logger
const logger = createLogger('bot');

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

// Helper function for webhook server to send ack
function sendAck(chatId, message) {
  logger.info('Sending Telegram ack from webhook server', { chatId });
  return sendTgAck(bot, chatId, message)
    .then(result => {
      logger.debug('Ack sent successfully', { messageId: result.message_id });
      return result;
    })
    .catch((error) => {
      logger.error('Error sending ack', error);
      throw error;
    });
}

// Log the state of pendingSlackAcks for debugging
logger.debug('pendingSlackAcks in bot.js at startup:', {
  isMap: pendingSlackAcks instanceof Map,
  size: pendingSlackAcks.size,
  keys: Array.from(pendingSlackAcks.keys())
});

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
    
    logger.info(`Bot is ready.. (Environment: ${config.DEPLOY_ENV || 'development'})`);
  } catch (err) {
    logger.error('Failed to start bot:', err);
  }
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

// Graceful shutdown
process.once('SIGINT', () => {
  if (process.env.BOT_PROCESS === 'true') {
    logger.info('Received SIGINT, stopping bot');
    bot.stop('SIGINT');
  }
});
process.once('SIGTERM', () => {
  if (process.env.BOT_PROCESS === 'true') {
    logger.info('Received SIGTERM, stopping bot');
    bot.stop('SIGTERM');
  }
});

export { bot, pendingSlackAcks, sendAck };
export default bot;