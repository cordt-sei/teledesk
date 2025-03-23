// tests/direct-ack-test.js - A simple script to directly test the acknowledgment endpoint
import axios from 'axios';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper to ask questions
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
  try {
    console.log('Direct Acknowledgment Test');
    console.log('=========================');
    
    // Get the base webhook URL from the env or use default
    const baseUrl = (process.env.SLACK_WEBHOOK_SERVER || 'http://localhost:3030/slack/interactions')
      .replace('/slack/interactions', '');
    const testUrl = `${baseUrl}/test-acknowledge`;
    
    console.log(`Using test endpoint: ${testUrl}`);
    
    // Get telegramChatId from user
    const chatId = await question('\nEnter your Telegram chat ID: ');
    if (!chatId) {
      console.log('No chat ID provided, exiting.');
      rl.close();
      return;
    }
    
    // Create a unique fake message timestamp
    const messageTs = `${Date.now()}.${Math.floor(Math.random() * 1000)}`;
    
    console.log('\nSending direct test request...');
    console.log(`Target Telegram chat: ${chatId}`);
    console.log(`Test message timestamp: ${messageTs}`);
    
    try {
      const response = await axios.post(testUrl, {
        messageTs: messageTs,
        chatId: chatId,
        userName: 'Test User'
      });
      
      console.log('\nTest request result:', response.data);
      
      if (response.data.success) {
        console.log('\n✅ Acknowledgment sent successfully!');
        console.log('Check your Telegram client to see if the message was received.');
      } else {
        console.log('\n❌ Failed to send acknowledgment.');
      }
    } catch (error) {
      console.error('\n❌ Error using test endpoint:', error.message);
      
      if (error.code === 'ECONNREFUSED') {
        console.log(`Server not reachable at ${testUrl}. Make sure it's running.`);
      } else if (error.response) {
        console.log('Server response:', error.response.data);
      }
    }
    
    rl.close();
  } catch (error) {
    console.error('Unexpected error:', error);
    rl.close();
  }
}

main();