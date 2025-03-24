// tests/test-webhook.js
import axios from 'axios';
import dotenv from 'dotenv';
import readline from 'readline';
import createLogger from '../modules/logger.js';

dotenv.config();

const logger = createLogger('webhookTester');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper to ask questions
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function testWebhook() {
  try {
    logger.info('========================================');
    logger.info(' Webhook Server Test Tool');
    logger.info('========================================');
    
    // Get the webhook URL
    const webhookUrl = process.env.SLACK_WEBHOOK_SERVER || 'http://localhost:3030/slack/interactions';
    const baseUrl = webhookUrl.replace('/slack/interactions', '');
    
    logger.info(`Using webhook server: ${baseUrl}`);
    
    // First check if the server is running
    try {
      const testUrl = `${baseUrl}/test`;
      logger.info(`\nChecking if webhook server is running at ${testUrl}...`);
      
      const testResponse = await axios.get(testUrl, { timeout: 3000 });
      logger.info(`🟢 Server is running: ${testResponse.data}`);
    } catch (error) {
      logger.error(`🔴 Server check failed: ${error.message}`);
      if (error.code === 'ECONNREFUSED') {
        logger.info('The webhook server is not running. Start it with "yarn dev" or "./startup.sh"');
      }
      rl.close();
      return;
    }
    
    logger.info('\nOptions:');
    logger.info('1. Check server health');
    logger.info('2. Check pending acknowledgments');
    logger.info('3. Test manual acknowledgment (with chatId)');
    logger.info('4. Exit');
    
    const choice = await question('\nEnter your choice (1-4): ');
    
    if (choice === '1') {
      // Check server health
      try {
        const healthUrl = `${baseUrl}/health`;
        logger.info(`\nChecking server health at ${healthUrl}...`);
        
        const response = await axios.get(healthUrl, { timeout: 3000 });
        
        logger.info('🟢 Server health check successful:');
        logger.info(JSON.stringify(response.data, null, 2));
      } catch (error) {
        logger.error(`🔴 Health check failed: ${error.message}`);
      }
    } else if (choice === '2') {
      // Check pending acknowledgments
      try {
        const acksUrl = `${baseUrl}/debug-acks`;
        logger.info(`\nChecking pending acknowledgments at ${acksUrl}...`);
        
        const response = await axios.get(acksUrl, { timeout: 3000 });
        
        const acks = response.data;
        if (acks.count === 0) {
          logger.info('No pending acknowledgments found');
        } else {
          logger.info(`Found ${acks.count} pending acknowledgments:`);
          acks.items.forEach((ack, index) => {
            logger.info(`\n[${index + 1}] Message: ${ack.messageTs}`);
            logger.info(`    Chat ID: ${ack.chatId}`);
            logger.info(`    Created: ${ack.timestamp}`);
            logger.info(`    Has Status Message: ${ack.hasStatusMessageId}`);
          });
        }
      } catch (error) {
        logger.error(`🔴 Failed to get pending acknowledgments: ${error.message}`);
        if (error.response?.status === 403) {
          logger.error('This endpoint is restricted in production mode');
        }
      }
    } else if (choice === '3') {
      // Test manual acknowledgment
      const chatId = await question('\nEnter Telegram chat ID to send acknowledgment to: ');
      if (!chatId) {
        logger.warn('No chat ID provided. Exiting.');
        rl.close();
        return;
      }
      
      const userName = await question('Enter acknowledging user name (optional): ') || 'Test User';
      
      try {
        const ackUrl = `${baseUrl}/test-acknowledge`;
        logger.info(`\nSending manual acknowledgment to chat ${chatId}...`);
        
        const response = await axios.post(ackUrl, {
          chatId: chatId,
          userName: userName
        }, { timeout: 5000 });
        
        if (response.data.success) {
          logger.info('🟢 Manual acknowledgment sent successfully!');
          logger.info(`Message ID: ${response.data.telegramMessageId}`);
        } else {
          logger.error(`🔴 Failed to send acknowledgment: ${response.data.error}`);
        }
      } catch (error) {
        logger.error(`🔴 Request failed: ${error.message}`);
        if (error.response?.data) {
          logger.error(`Error details: ${JSON.stringify(error.response.data)}`);
        }
      }
    } else {
      logger.info('Exiting...');
    }
    
    rl.close();
  } catch (error) {
    logger.error('Unexpected error:', error);
    rl.close();
  }
}

testWebhook();