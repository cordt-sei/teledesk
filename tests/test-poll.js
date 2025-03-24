// tests/test-poll.js
// A simple test script to directly check the polling functionality

import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { initializeState, pendingSlackAcks } from '../modules/state.js';
import createLogger from '../modules/logger.js';
import axios from 'axios';
import config from '../config.js';

// Load environment variables
dotenv.config();

// Initialize logger
const logger = createLogger('test-poll');

// Initialize bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Initialize state
initializeState();

// Polling function - direct implementation for testing
async function checkReactions() {
  const pendingCount = pendingSlackAcks.size;
  logger.info(`Running reaction check cycle, pendingAcks size: ${pendingCount}`);
  
  if (pendingCount === 0) {
    logger.info('No pending acknowledgments to check');
    return;
  }
  
  // Get all pending message timestamps
  const pendingMessageTimestamps = Array.from(pendingSlackAcks.keys());
  
  for (const messageTs of pendingMessageTimestamps) {
    logger.info(`Checking reactions for message ${messageTs} in channel ${config.SLACK_CHANNEL_ID}`);
    

    try {
      const url = `https://slack.com/api/reactions.get?channel=${encodeURIComponent(config.SLACK_CHANNEL_ID)}&timestamp=${encodeURIComponent(messageTs)}`;
      
      logger.info(`Requesting reactions from Slack API for message ${messageTs}`);
      const response = await axios.get(url, {    // Get reactions for this message
        headers: {
          'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
        }
      });
      
      // Log the full response for debugging
      logger.info(`Reaction API response for ${messageTs}:`, response.data);
      
      if (!response.data.ok) {
        logger.error(`Slack API error getting reactions: ${response.data.error}`);
        continue;
      }
      
      // Check if there are any reactions
      if (response.data.message && response.data.message.reactions) {
        const reactions = response.data.message.reactions;
        logger.info(`Found ${reactions.length} reactions:`, reactions.map(r => r.name).join(', '));
        
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
        
        if (ackReaction) {
          logger.info(`Found acknowledgment reaction: ${ackReaction.name}`);
          
          // Get pending info
          const pendingInfo = pendingSlackAcks.get(messageTs);
          logger.info(`Pending info for message ${messageTs}:`, pendingInfo);
          
          // If we have pending info, send acknowledgment
          if (pendingInfo && pendingInfo.telegramChatId) {
            logger.info(`Sending acknowledgment to Telegram chat ID ${pendingInfo.telegramChatId}`);
            
            try {
              const ackMessage = `🟢 Test: Your forwarded message has been acknowledged at ${new Date().toLocaleString()}.`;
              
              if (pendingInfo.statusMessageId) {
                logger.info(`Attempting to update status message ${pendingInfo.statusMessageId}`);
                await bot.telegram.editMessageText(
                  pendingInfo.telegramChatId,
                  pendingInfo.statusMessageId,
                  null,
                  ackMessage
                );
                logger.info(`Successfully updated status message`);
              } else {
                logger.info(`No status message ID, sending as new message`);
                await bot.telegram.sendMessage(pendingInfo.telegramChatId, ackMessage);
                logger.info(`Sent as new message`);
              }
              
              logger.info(`Acknowledgment sent successfully`);
            } catch (error) {
              logger.error(`Error sending acknowledgment:`, error);
            }
          }
        } else {
          logger.info(`No acknowledgment reaction found`);
        }
      } else {
        logger.info(`No reactions found on message ${messageTs}`);
      }
    } catch (error) {
      logger.error(`Error checking reactions for message ${messageTs}:`, error);
    }
  }
}

// Run the test
async function runTest() {
  logger.info('Starting reaction polling test...');
  
  // Run the check several times
  for (let i = 0; i < 3; i++) {
    logger.info(`Run ${i + 1}...`);
    await checkReactions();
    
    // Wait 5 seconds between runs
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  logger.info('Test complete');
  process.exit(0);
}

// Run the test
runTest().catch(error => {
  logger.error('Unhandled error in test:', error);
  process.exit(1);
});