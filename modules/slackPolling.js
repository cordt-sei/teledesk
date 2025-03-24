import axios from 'axios';
import config from '../config.js';
import { pendingSlackAcks, savePendingAcksToDisk } from './state.js';
import createLogger from './logger.js';
// Import your existing Slack user-lookup function:
import { getSlackUserName } from '../bot.js';

const logger = createLogger('slackPolling');

// Poll every 5 seconds
const POLLING_INTERVAL = 5000;

// Start polling for reactions to pending messages
export function startReactionPolling(bot) {
  logger.info('Starting Slack reaction polling...');

  // Immediately do a one-time check
  logger.info('Running initial reaction check...');
  checkForReactions(bot).catch(error => {
    logger.error('Error in initial reaction check:', error);
  });

  // Set up interval for periodic checks
  const pollInterval = setInterval(() => {
    logger.info('Running periodic reaction check from interval...');
    checkForReactions(bot).catch(error => {
      logger.error('Error in reaction polling:', error);
    });
  }, POLLING_INTERVAL);

  return pollInterval;
}

// Check for reactions on all pending messages
export async function checkForReactions(bot) {
  const pendingCount = pendingSlackAcks.size;
  logger.info(`Running reaction check cycle; pendingAcks size: ${pendingCount}`);

  if (pendingCount === 0) {
    logger.info('No pending acknowledgments to check');
    return;
  }

  // Debug: log all pending messageTs
  const allPending = Array.from(pendingSlackAcks.keys());
  logger.info('Current pending message timestamps:', allPending);

  for (const messageTs of allPending) {
    try {
      // Confirm this entry still exists (may have been deleted mid-loop)
      if (!pendingSlackAcks.has(messageTs)) {
        logger.info(`Message ${messageTs} was removed from pendingAcks; skipping`);
        continue;
      }

      const pendingInfo = pendingSlackAcks.get(messageTs);
      if (!pendingInfo) {
        logger.warn(`No pending info found for ${messageTs}, removing`);
        pendingSlackAcks.delete(messageTs);
        await savePendingAcksToDisk();
        continue;
      }

      const { telegramChatId, statusMessageId } = pendingInfo;
      logger.info(`Checking Slack message ${messageTs} in channel ${config.SLACK_CHANNEL_ID}`);

      // Call Slack API reactions.get
      const url = `https://slack.com/api/reactions.get?channel=${encodeURIComponent(config.SLACK_CHANNEL_ID)}&timestamp=${encodeURIComponent(messageTs)}`;
      logger.info(`Requesting reactions for ${messageTs} from Slack`);
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
        }
      });

      // Log Slack response
      logger.info(`Slack response for ${messageTs}:`, response.data);

      // If Slack returns an error, skip
      if (!response.data.ok) {
        logger.error(`Slack API error for ${messageTs}: ${response.data.error}`);
        continue;
      }

      // If no message or reactions in the response, skip
      const slackMsg = response.data.message;
      if (!slackMsg || !slackMsg.reactions) {
        logger.info(`No reactions found for message ${messageTs}`);
        continue;
      }

      // recognized ack emojis
      const ackReaction = slackMsg.reactions.find(r =>
        ['white_check_mark', 'white_tick', 'check', 'heavy_check_mark', '+1', 'thumbsup', 'eye', 'eyes'].includes(r.name)
      );

      if (!ackReaction) {
        logger.info(`No matching acknowledgment reaction found on ${messageTs}`);
        continue;
      }

      logger.info(`Found acknowledgment reaction (${ackReaction.name}) on ${messageTs}`);

      // Get the Slack user ID who reacted
      let userName = 'Team Member';
      if (ackReaction.users && ackReaction.users.length > 0) {
        const slackUserId = ackReaction.users[0];
        logger.info(`Fetching user info for Slack user ${slackUserId}...`);
        
        // Call your existing function from bot.js
        userName = await getSlackUserName(slackUserId);

        logger.info(`Slack user name: ${userName}`);
      }

      // Prepare final ack message for Telegram
      const ackTime = new Date().toLocaleString();
      const ackMessage = `🟢 Your forwarded message has been acknowledged by ${userName} at ${ackTime}.`;

      // Edit or send a new message in Telegram
      try {
        if (statusMessageId) {
          logger.info(`Updating status message ${statusMessageId} in chat ${telegramChatId}`);
          await bot.telegram.editMessageText(
            telegramChatId,
            statusMessageId,
            null, // inline message id
            ackMessage
          ).catch(async editError => {
            logger.warn(`editMessageText failed: ${editError.message}, sending new message instead`);
            await bot.telegram.sendMessage(telegramChatId, ackMessage);
          });
        } else {
          logger.info(`No statusMessageId, sending new message to chat ${telegramChatId}`);
          await bot.telegram.sendMessage(telegramChatId, ackMessage);
        }

        // Remove from pending since it's acknowledged
        pendingSlackAcks.delete(messageTs);
        await savePendingAcksToDisk();
        logger.info(`Removed ${messageTs} from pending acks; ${pendingSlackAcks.size} remaining`);
      } catch (ackError) {
        logger.error(`Error sending ack to Telegram for ${messageTs}:`, ackError);
      }
    } catch (err) {
      logger.error(`Error checking reactions for ${messageTs}:`, err);
    }
  }
}
