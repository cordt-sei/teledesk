// tests/test-user-zendesk-flow.js
// Test the Zendesk ticket creation and update flow for regular users

import readline from 'readline';
import dotenv from 'dotenv';
import axios from 'axios';
import { Telegraf } from 'telegraf';
import config from '../config.js';
import createLogger from '../modules/logger.js';

// Initialize logger
const logger = createLogger('test-zendesk-flow');

// Load environment variables
dotenv.config();

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Promisify the question method
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Main function
async function main() {
  console.log(`${colors.cyan}================================================${colors.reset}`);
  console.log(`${colors.cyan}=== Zendesk User Flow Test =====================${colors.reset}`);
  console.log(`${colors.cyan}================================================${colors.reset}`);
  
  // Validate configuration
  console.log(`\n${colors.blue}Validating configuration...${colors.reset}`);
  
  if (!process.env.ZENDESK_API_URL) {
    console.log(`${colors.red}Error: ZENDESK_API_URL is not set${colors.reset}`);
    process.exit(1);
  }
  
  if (!process.env.ZENDESK_EMAIL) {
    console.log(`${colors.red}Error: ZENDESK_EMAIL is not set${colors.reset}`);
    process.exit(1);
  }
  
  if (!process.env.ZENDESK_API_TOKEN) {
    console.log(`${colors.red}Error: ZENDESK_API_TOKEN is not set${colors.reset}`);
    process.exit(1);
  }
  
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log(`${colors.red}Error: TELEGRAM_BOT_TOKEN is not set${colors.reset}`);
    process.exit(1);
  }
  
  // Initialize bot
  let bot;
  try {
    bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    console.log(`${colors.green}Telegram bot initialized${colors.reset}`);
  } catch (error) {
    console.log(`${colors.red}Failed to initialize Telegram bot: ${error.message}${colors.reset}`);
    process.exit(1);
  }
  
  // Main menu
  await showMainMenu(bot);
  
  rl.on('close', () => {
    console.log(`${colors.cyan}Thank you for using the Zendesk Flow Test Tool${colors.reset}`);
    process.exit(0);
  });
}

// Show main menu
async function showMainMenu(bot) {
  console.log(`\n${colors.cyan}=== Main Menu ===${colors.reset}`);
  console.log(`1. Test Zendesk API Connection`);
  console.log(`2. Create Test Ticket`);
  console.log(`3. Get User's Active Tickets`);
  console.log(`4. Add Comment to Ticket`);
  console.log(`5. Close Ticket`);
  console.log(`6. Send Test Message to Telegram User`);
  console.log(`9. Exit`);
  
  const choice = await question(`\nEnter choice [1-9]: `);
  
  switch (choice) {
    case '1':
      await testZendeskConnection();
      break;
    case '2':
      await createTestTicket();
      break;
    case '3':
      await getActiveTickets();
      break;
    case '4':
      await addCommentToTicket();
      break;
    case '5':
      await closeTicket();
      break;
    case '6':
      await sendTelegramMessage(bot);
      break;
    case '9':
      rl.close();
      return;
    default:
      console.log(`${colors.yellow}Invalid choice${colors.reset}`);
  }
  
  await showMainMenu(bot);
}

// Test Zendesk API Connection
async function testZendeskConnection() {
  console.log(`\n${colors.cyan}=== Testing Zendesk API Connection ===${colors.reset}`);
  
  try {
    console.log(`${colors.blue}Connecting to Zendesk...${colors.reset}`);
    
    const response = await axios.get(
      `${process.env.ZENDESK_API_URL}/users/me.json`,
      {
        auth: {
          username: `${process.env.ZENDESK_EMAIL}/token`,
          password: process.env.ZENDESK_API_TOKEN
        }
      }
    );
    
    console.log(`${colors.green}Successfully connected to Zendesk${colors.reset}`);
    console.log(`Account: ${response.data.user.url.split('/')[2]}`);
    console.log(`User: ${response.data.user.name} (${response.data.user.email})`);
    console.log(`Role: ${response.data.user.role}`);
    
  } catch (error) {
    console.log(`${colors.red}Error connecting to Zendesk API:${colors.reset}`);
    
    if (error.response) {
      console.log(`${colors.red}HTTP Status: ${error.response.status}${colors.reset}`);
      console.log(`${colors.red}Response: ${JSON.stringify(error.response.data, null, 2)}${colors.reset}`);
    } else {
      console.log(`${colors.red}${error.message}${colors.reset}`);
    }
  }
}

// Create a test ticket
async function createTestTicket() {
  console.log(`\n${colors.cyan}=== Create Test Ticket ===${colors.reset}`);
  
  const username = await question(`Enter requester name: `);
  const userId = await question(`Enter Telegram user ID: `);
  const subject = await question(`Enter ticket subject: `) || 'Test Ticket';
  const description = await question(`Enter ticket description: `) || 'This is a test ticket created via the test tool.';
  
  // Get priority
  console.log(`\nPriority options:`);
  console.log(`1. Low`);
  console.log(`2. Normal`);
  console.log(`3. High`);
  console.log(`4. Urgent`);
  
  const priorityChoice = await question(`Enter priority [1-4]: `);
  
  let priority = 'normal';
  let severityTag = 'priority_normal';
  
  switch (priorityChoice) {
    case '1':
      priority = 'low';
      severityTag = 'priority_low';
      break;
    case '3':
      priority = 'high';
      severityTag = 'priority_high';
      break;
    case '4':
      priority = 'urgent';
      severityTag = 'priority_urgent';
      break;
    default:
      priority = 'normal';
      severityTag = 'priority_normal';
  }
  
  try {
    console.log(`${colors.blue}Creating Zendesk ticket...${colors.reset}`);
    
    const response = await axios.post(
      `${process.env.ZENDESK_API_URL}/tickets.json`,
      {
        ticket: {
          subject: `[${priority.toUpperCase()}] ${subject}`,
          comment: {
            body: description
          },
          requester: {
            name: username,
            email: `telegram.${userId}@example.com`
          },
          priority: priority,
          tags: ['telegram', severityTag, 'test_ticket']
        }
      },
      {
        auth: {
          username: `${process.env.ZENDESK_EMAIL}/token`,
          password: process.env.ZENDESK_API_TOKEN
        }
      }
    );
    
    const ticketId = response.data.ticket.id;
    
    console.log(`${colors.green}Ticket created successfully${colors.reset}`);
    console.log(`Ticket ID: ${ticketId}`);
    console.log(`Subject: ${response.data.ticket.subject}`);
    console.log(`Priority: ${response.data.ticket.priority}`);
    console.log(`Status: ${response.data.ticket.status}`);
    console.log(`Created At: ${response.data.ticket.created_at}`);
    
    // Store for future use
    global.lastTicketId = ticketId;
    global.lastTicketUserId = userId;
    
  } catch (error) {
    console.log(`${colors.red}Error creating ticket:${colors.reset}`);
    
    if (error.response) {
      console.log(`${colors.red}HTTP Status: ${error.response.status}${colors.reset}`);
      console.log(`${colors.red}Response: ${JSON.stringify(error.response.data, null, 2)}${colors.reset}`);
    } else {
      console.log(`${colors.red}${error.message}${colors.reset}`);
    }
  }
}

// Get active tickets for a user
async function getActiveTickets() {
  console.log(`\n${colors.cyan}=== Get Active Tickets ===${colors.reset}`);
  
  const userId = await question(`Enter Telegram user ID: `);
  
  try {
    console.log(`${colors.blue}Searching for active tickets...${colors.reset}`);
    
    const searchResponse = await axios.get(
      `${process.env.ZENDESK_API_URL}/search.json`,
      {
        params: {
          query: `requester:telegram.${userId}@example.com type:ticket status<solved`
        },
        auth: {
          username: `${process.env.ZENDESK_EMAIL}/token`,
          password: process.env.ZENDESK_API_TOKEN
        }
      }
    );
    
    if (searchResponse.data.results && searchResponse.data.results.length > 0) {
      console.log(`${colors.green}Found ${searchResponse.data.results.length} active tickets:${colors.reset}`);
      
      searchResponse.data.results.forEach((ticket, index) => {
        console.log(`\n${colors.blue}Ticket ${index + 1}:${colors.reset}`);
        console.log(`ID: ${ticket.id}`);
        console.log(`Subject: ${ticket.subject}`);
        console.log(`Status: ${ticket.status}`);
        console.log(`Priority: ${ticket.priority || 'normal'}`);
        console.log(`Created: ${new Date(ticket.created_at).toLocaleString()}`);
        console.log(`Updated: ${new Date(ticket.updated_at).toLocaleString()}`);
        
        // Store most recent ticket ID for convenience
        if (index === 0) {
          global.lastTicketId = ticket.id;
          global.lastTicketUserId = userId;
        }
      });
    } else {
      console.log(`${colors.yellow}No active tickets found for this user${colors.reset}`);
    }
  } catch (error) {
    console.log(`${colors.red}Error searching for tickets:${colors.reset}`);
    
    if (error.response) {
      console.log(`${colors.red}HTTP Status: ${error.response.status}${colors.reset}`);
      console.log(`${colors.red}Response: ${JSON.stringify(error.response.data, null, 2)}${colors.reset}`);
    } else {
      console.log(`${colors.red}${error.message}${colors.reset}`);
    }
  }
}

// Add comment to ticket
async function addCommentToTicket() {
  console.log(`\n${colors.cyan}=== Add Comment to Ticket ===${colors.reset}`);
  
  let ticketId = global.lastTicketId;
  if (ticketId) {
    console.log(`${colors.blue}Using last ticket ID: ${ticketId}${colors.reset}`);
    const useLastTicket = await question(`Use this ticket? (Y/n): `);
    if (useLastTicket.toLowerCase() === 'n') {
      ticketId = null;
    }
  }
  
  if (!ticketId) {
    ticketId = await question(`Enter ticket ID: `);
  }
  
  const comment = await question(`Enter comment text: `);
  const isPublic = await question(`Make comment public? (Y/n): `);
  const publicComment = isPublic.toLowerCase() !== 'n';
  
  try {
    console.log(`${colors.blue}Adding comment to ticket...${colors.reset}`);
    
    const response = await axios.put(
      `${process.env.ZENDESK_API_URL}/tickets/${ticketId}.json`,
      {
        ticket: {
          comment: {
            body: comment,
            public: publicComment
          }
        }
      },
      {
        auth: {
          username: `${process.env.ZENDESK_EMAIL}/token`,
          password: process.env.ZENDESK_API_TOKEN
        }
      }
    );
    
    console.log(`${colors.green}Comment added successfully${colors.reset}`);
    console.log(`Ticket ID: ${response.data.ticket.id}`);
    console.log(`Updated At: ${response.data.ticket.updated_at}`);
    console.log(`Comment Visibility: ${publicComment ? 'Public' : 'Internal'}`);
    
  } catch (error) {
    console.log(`${colors.red}Error adding comment:${colors.reset}`);
    
    if (error.response) {
      console.log(`${colors.red}HTTP Status: ${error.response.status}${colors.reset}`);
      console.log(`${colors.red}Response: ${JSON.stringify(error.response.data, null, 2)}${colors.reset}`);
    } else {
      console.log(`${colors.red}${error.message}${colors.reset}`);
    }
  }
}

// Close ticket
async function closeTicket() {
  console.log(`\n${colors.cyan}=== Close Ticket ===${colors.reset}`);
  
  let ticketId = global.lastTicketId;
  if (ticketId) {
    console.log(`${colors.blue}Using last ticket ID: ${ticketId}${colors.reset}`);
    const useLastTicket = await question(`Use this ticket? (Y/n): `);
    if (useLastTicket.toLowerCase() === 'n') {
      ticketId = null;
    }
  }
  
  if (!ticketId) {
    ticketId = await question(`Enter ticket ID: `);
  }
  
  try {
    console.log(`${colors.blue}Closing ticket...${colors.reset}`);
    
    const response = await axios.put(
      `${process.env.ZENDESK_API_URL}/tickets/${ticketId}.json`,
      {
        ticket: {
          status: 'solved',
          comment: {
            body: 'Ticket closed via test tool.',
            public: false
          }
        }
      },
      {
        auth: {
          username: `${process.env.ZENDESK_EMAIL}/token`,
          password: process.env.ZENDESK_API_TOKEN
        }
      }
    );
    
    console.log(`${colors.green}Ticket closed successfully${colors.reset}`);
    console.log(`Ticket ID: ${response.data.ticket.id}`);
    console.log(`Status: ${response.data.ticket.status}`);
    console.log(`Updated At: ${response.data.ticket.updated_at}`);
    
  } catch (error) {
    console.log(`${colors.red}Error closing ticket:${colors.reset}`);
    
    if (error.response) {
      console.log(`${colors.red}HTTP Status: ${error.response.status}${colors.reset}`);
      console.log(`${colors.red}Response: ${JSON.stringify(error.response.data, null, 2)}${colors.reset}`);
    } else {
      console.log(`${colors.red}${error.message}${colors.reset}`);
    }
  }
}

// Send test message to Telegram user
async function sendTelegramMessage(bot) {
  console.log(`\n${colors.cyan}=== Send Test Message to Telegram User ===${colors.reset}`);
  
  let chatId = global.lastTicketUserId;
  if (chatId) {
    console.log(`${colors.blue}Using last user ID: ${chatId}${colors.reset}`);
    const useLastUser = await question(`Use this user? (Y/n): `);
    if (useLastUser.toLowerCase() === 'n') {
      chatId = null;
    }
  }
  
  if (!chatId) {
    chatId = await question(`Enter Telegram chat ID: `);
  }
  
  const message = await question(`Enter message to send: `) || 'This is a test message from the Zendesk Flow Test Tool';
  
  try {
    console.log(`${colors.blue}Sending message to Telegram...${colors.reset}`);
    
    const result = await bot.telegram.sendMessage(chatId, message);
    
    console.log(`${colors.green}Message sent successfully${colors.reset}`);
    console.log(`Message ID: ${result.message_id}`);
    console.log(`Chat ID: ${result.chat.id}`);
    
  } catch (error) {
    console.log(`${colors.red}Error sending Telegram message:${colors.reset}`);
    console.log(`${colors.red}${error.message}${colors.reset}`);
    
    if (error.response) {
      console.log(`${colors.red}Response:${colors.reset}`, error.response);
    }
  }
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  rl.close();
  process.exit(1);
});