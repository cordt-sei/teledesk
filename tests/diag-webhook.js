// tests/diagnose-webhook.js
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import createLogger from '../modules/logger.js';

dotenv.config();

const logger = createLogger('webhookDiagnostics');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pendingAcksFile = path.join(__dirname, '..', 'data', 'pendingAcks.json');

async function diagnoseWebhookIssues() {
  logger.info('Starting webhook diagnostics...');
  
  // Check environment variables
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const slackToken = process.env.SLACK_API_TOKEN;
  const slackChannelId = process.env.SLACK_CHANNEL_ID;
  const webhookUrl = process.env.SLACK_WEBHOOK_SERVER || 'http://localhost:3030/slack/interactions';
  
  const issues = [];
  
  logger.info('Checking environment variables...');
  
  if (!telegramToken) {
    issues.push('🔴 TELEGRAM_BOT_TOKEN is not set in environment');
  } else {
    logger.info('🟢 TELEGRAM_BOT_TOKEN is set');
  }
  
  if (!slackToken) {
    issues.push('🔴 SLACK_API_TOKEN is not set in environment');
  } else {
    logger.info('🟢 SLACK_API_TOKEN is set');
  }
  
  // Check if webhook server is running
  logger.info(`Checking webhook server at ${webhookUrl}...`);
  try {
    // Check the test endpoint
    const testUrl = webhookUrl.replace('/slack/interactions', '/test');
    const response = await axios.get(testUrl, { timeout: 5000 });
    if (response.status === 200) {
      logger.info(`🟢 Webhook server is responsive (${response.data})`);
    } else {
      issues.push(`🟡️ Webhook server returned unexpected status: ${response.status}`);
    }
  } catch (error) {
    issues.push(`🔴 Webhook server is not reachable at ${webhookUrl.replace('/slack/interactions', '/test')}: ${error.message}`);
  }
  
  // Check if data directory exists
  logger.info('Checking data directory...');
  try {
    await fs.access(path.join(__dirname, '..', 'data'));
    logger.info('🟢 Data directory exists');
  } catch (error) {
    issues.push('🔴 Data directory does not exist or is not accessible');
  }
  
  // Check if pendingAcks.json exists and has valid content
  logger.info('Checking pendingAcks.json...');
  try {
    await fs.access(pendingAcksFile);
    const data = await fs.readFile(pendingAcksFile, 'utf8');
    try {
      const acks = JSON.parse(data);
      logger.info(`🟢 pendingAcks.json exists and contains ${Object.keys(acks).length} entries`);
      
      // Show a sample of entries if available
      if (Object.keys(acks).length > 0) {
        const sampleKey = Object.keys(acks)[0];
        const sample = acks[sampleKey];
        logger.info('Sample pendingAck entry:', {
          messageTs: sampleKey,
          telegramChatId: sample.telegramChatId,
          statusMessageId: sample.statusMessageId,
          timestamp: new Date(sample.timestamp).toLocaleString()
        });
      }
    } catch (error) {
      issues.push('🔴 pendingAcks.json contains invalid JSON');
    }
  } catch (error) {
    issues.push('🟡️ pendingAcks.json does not exist (this is normal if no messages have been forwarded yet)');
  }
  
  // Check bot status
  logger.info('Checking Telegram bot status...');
  try {
    const response = await axios.get(`https://api.telegram.org/bot${telegramToken}/getMe`);
    if (response.data.ok) {
      logger.info(`🟢 Telegram bot is active: @${response.data.result.username}`);
    } else {
      issues.push('🔴 Telegram bot is not responding properly');
    }
  } catch (error) {
    issues.push(`🔴 Could not connect to Telegram: ${error.message}`);
  }
  
  // Add direct test for sending a message to Telegram
  if (issues.length === 0) {
    logger.info('Testing direct message to Telegram...');
    
    try {
      // Get sample chat ID from pendingAcks.json if available
      let testChatId;
      try {
        const data = await fs.readFile(pendingAcksFile, 'utf8');
        const acks = JSON.parse(data);
        const firstEntry = Object.values(acks)[0];
        if (firstEntry && firstEntry.telegramChatId) {
          testChatId = firstEntry.telegramChatId;
        }
      } catch (error) {
        logger.warn('Could not get test chat ID from pendingAcks.json');
      }
      
      if (testChatId) {
        const messageResponse = await axios.post(
          `https://api.telegram.org/bot${telegramToken}/sendMessage`,
          {
            chat_id: testChatId,
            text: ' This is a webhook diagnostic test message. If you see this, direct messaging is working.'
          }
        );
        
        if (messageResponse.data.ok) {
          logger.info('🟢 Successfully sent test message to Telegram');
        } else {
          issues.push('🔴 Failed to send test message to Telegram');
        }
      } else {
        logger.info('🟡️ Skipping direct message test - no chat ID available');
      }
    } catch (error) {
      issues.push(`🔴 Error sending test message to Telegram: ${error.message}`);
    }
  }
  
  // Summary
  if (issues.length > 0) {
    logger.info('\n===== ISSUES FOUND =====');
    issues.forEach(issue => logger.info(issue));
    
    logger.info('\n===== RECOMMENDED ACTIONS =====');
    if (issues.some(i => i.includes('Webhook server is not reachable'))) {
      logger.info('• Make sure the webhook server is running with: yarn dev:webhook');
      logger.info('• Check if another process is using port 3030: lsof -i :3030');
    }
    if (issues.some(i => i.includes('pendingAcks.json'))) {
      logger.info('• Create the data directory: mkdir -p data');
      logger.info('• Ensure the process has write permissions: chmod 755 data');
    }
    if (issues.some(i => i.includes('Could not connect to Telegram'))) {
      logger.info('• Check your TELEGRAM_BOT_TOKEN in .env');
      logger.info('• Try clearing the webhook: node clear-webhook.js');
    }
    if (issues.some(i => i.includes('Failed to send test message'))) {
      logger.info('• Check if your bot has been blocked by the user');
      logger.info('• Verify permissions for the bot token');
    }
  } else {
    logger.info('\n🟢 All diagnostics passed! The webhook and acknowledgment system should be working properly.');
  }
}

diagnoseWebhookIssues().catch(err => {
  logger.error('Diagnostics error:', err);
});