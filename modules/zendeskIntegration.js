// modules/zendeskIntegration.js
import axios from 'axios';
import { Markup } from 'telegraf';
import config from '../config.js';
import createLogger from './logger.js';

const logger = createLogger('zendeskIntegration');

// active tickets by user ID
const activeTickets = new Map();

// ticket creation or updates
export async function handleSupportTicket(ctx, isUpdate = false, forceNew = false) {
  try {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'Unknown User';
    const message = ctx.message.text || 'No description provided';
    
    // Look for severity/priority indicators in the message
    let severity = 'Normal';
    let severityTag = 'priority_normal';
    
    if (message.toLowerCase().includes('urgent') || message.toLowerCase().includes('incident')) {
      severity = 'Urgent';
      severityTag = 'priority_urgent';
    } else if (message.toLowerCase().includes('high priority') || message.toLowerCase().includes('critical')) {
      severity = 'High';
      severityTag = 'priority_high';
    } else if (message.toLowerCase().includes('medium priority')) {
      severity = 'Medium';
      severityTag = 'priority_medium';
    } else if (message.toLowerCase().includes('low priority')) {
      severity = 'Low';
      severityTag = 'priority_low';
    }
    
    if (isUpdate) {
      // Add comment to existing ticket
      const ticket = await getActiveTicket(userId);
      
      if (ticket) {
        await addCommentToTicket(ticket.id, message, username);
        await ctx.reply(
          "🟢 Your message has been added to your existing support ticket.\n\n" +
          "A team member will respond shortly."
        );
      } else {
        // No active ticket found, create a new one
        const ticketId = await createZendeskTicket(message, username, userId, severity, severityTag);
        await ctx.reply(
          `🟢 We couldn't find an existing ticket, so we've created a new support ticket (#${ticketId}).\n\n` +
          "A team member will respond shortly."
        );
      }
      return { status: 'complete' };
    } else {
      // Check if user already has an active ticket and we're not forcing a new ticket
      const existingTicket = await getActiveTicket(userId);
      
      if (existingTicket && !forceNew) {
        // User has an existing ticket - offer options
        await ctx.reply(
          `You have an active ticket (#${existingTicket.id}): "${existingTicket.subject}"\n\n` +
          "Is your new message related to this ticket?",
          Markup.inlineKeyboard([
            [Markup.button.callback('🟢 Yes, add to existing ticket', 'add_to_existing')],
            [Markup.button.callback('📝 No, create a new ticket', 'create_new_ticket')]
          ])
        );
        
        // Return info needed for handling the choice
        return {
          status: 'choice_required',
          message: message,
          severity: severity,
          severityTag: severityTag,
          existingTicketId: existingTicket.id
        };
      } else {
        // No existing ticket or force new ticket, create a new one
        const ticketId = await createZendeskTicket(message, username, userId, severity, severityTag);
        await ctx.reply(
          `🟢 Your support ticket (#${ticketId}) has been created with ${severity} priority.\n\n` +
          "A team member will respond shortly."
        );
        return { status: 'complete' };
      }
    }
  } catch (error) {
    logger.error('Error creating support ticket:', error);
    await ctx.reply(
      "🔴 There was an issue processing your support request. Please try again later."
    );
    return { status: 'error' };
  }
}

// Get active ticket information
export async function getActiveTicket(userId) {
  try {
    // if ticket ID in cache, get details
    const cachedTicketId = activeTickets.get(userId);
    
    if (cachedTicketId) {
      const response = await axios.get(
        `${config.ZENDESK_API_URL}/tickets/${cachedTicketId}.json`,
        {
          auth: {
            username: `${config.ZENDESK_EMAIL}/token`,
            password: config.ZENDESK_API_TOKEN
          }
        }
      );
      
      return response.data.ticket;
    }
    
    // If not cached, try to find by searching for the user's email
    const searchResponse = await axios.get(
      `${config.ZENDESK_API_URL}/search.json`,
      {
        params: {
          query: `requester:telegram.${userId}@example.com type:ticket status<solved`
        },
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    if (searchResponse.data.results && searchResponse.data.results.length > 0) {
      // Found a ticket, get the most recent one
      const ticket = searchResponse.data.results[0];
      
      // Cache for future use
      activeTickets.set(userId, ticket.id);
      
      return ticket;
    }
    
    return null;
  } catch (error) {
    logger.error('Error getting active ticket:', error);
    return null;
  }
}

// Close a ticket
export async function closeTicket(userId) {
  try {
    const ticket = await getActiveTicket(userId);
    
    if (!ticket) {
      return false;
    }
    
    await axios.put(
      `${config.ZENDESK_API_URL}/tickets/${ticket.id}.json`,
      {
        ticket: {
          status: 'solved',
          comment: {
            body: 'Ticket closed by user via Telegram bot.',
            public: false
          }
        }
      },
      {
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    // Remove from active tickets
    activeTickets.delete(userId);
    
    return true;
  } catch (error) {
    logger.error('Error closing ticket:', error);
    return false;
  }
}

/**
 * Reopen a closed ticket
 * @param {number} userId - Telegram user ID
 * @returns {Promise<boolean>} Success status
 */
export async function reopenTicket(userId) {
  try {
    // Search for the user's most recent tickets, including solved ones
    const searchResponse = await axios.get(
      `${config.ZENDESK_API_URL}/search.json`,
      {
        params: {
          query: `requester:telegram.${userId}@example.com type:ticket status:solved`
        },
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    if (!searchResponse.data.results || searchResponse.data.results.length === 0) {
      logger.info(`No closed tickets found for user ${userId}`);
      return false;
    }
    
    // Get the most recent closed ticket
    const ticket = searchResponse.data.results[0];
    logger.info(`Found closed ticket ${ticket.id} for user ${userId}`);
    
    // Reopen the ticket
    await axios.put(
      `${config.ZENDESK_API_URL}/tickets/${ticket.id}.json`,
      {
        ticket: {
          status: 'open',
          comment: {
            body: 'Ticket reopened by user via Telegram bot.',
            public: false
          }
        }
      },
      {
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    // Update the active tickets cache
    activeTickets.set(userId, ticket.id);
    
    logger.info(`Successfully reopened ticket ${ticket.id} for user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error reopening ticket:', error);
    return false;
  }
}

// Create a new Zendesk ticket
export async function createZendeskTicket(description, username, userId, severity = 'Normal', severityTag = 'priority_normal') {
  try {
    logger.info(`Creating Zendesk ticket for ${username} with severity ${severity}`);
    
    const response = await axios.post(
      `${config.ZENDESK_API_URL}/tickets.json`,
      {
        ticket: {
          subject: severity ? `[${severity}] Support Request from ${username}` : `Support Request from ${username}`,
          comment: {
            body: description
          },
          requester: {
            name: username,
            email: `telegram.${userId}@example.com`
          },
          priority: severity ? severity.toLowerCase() : 'normal',
          tags: ["telegram", severityTag]
        }
      },
      {
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    const ticketId = response.data.ticket.id;
    logger.info(`Zendesk ticket created: ${ticketId}`);
    
    // Cache the ticket
    activeTickets.set(userId, ticketId);
    
    // Notify Slack
    await notifySlackOfNewTicket(ticketId, username, description, severity);
    
    return ticketId;
  } catch (error) {
    logger.error('Error creating Zendesk ticket:', error);
    logger.error('Response data:', error.response?.data);
    throw error;
  }
}

// Add a comment to an existing ticket
export async function addCommentToTicket(ticketId, comment, username) {
  try {
    await axios.put(
      `${config.ZENDESK_API_URL}/tickets/${ticketId}.json`,
      {
        ticket: {
          comment: {
            body: `${username}: ${comment}`,
            public: true
          }
        }
      },
      {
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    return true;
  } catch (error) {
    logger.error('Error adding comment to Zendesk ticket:', error.response?.data || error.message);
    throw error;
  }
}

// Get Help Center categories
export async function getHelpCenterCategories() {
  try {
    const response = await axios.get(
      `${config.ZENDESK_API_URL.replace('/api/v2', '')}/api/v2/help_center/categories.json`,
      {
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    return response.data.categories;
  } catch (error) {
    logger.error('Error fetching Help Center categories:', error);
    return [];
  }
}

// Search the Help Center
export async function searchHelpCenter(query) {
  try {
    const response = await axios.get(
      `${config.ZENDESK_API_URL.replace('/api/v2', '')}/api/v2/help_center/articles/search.json`,
      {
        params: {
          query: query
        },
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    return response.data.results;
  } catch (error) {
    logger.error('Error searching Help Center:', error);
    return [];
  }
}

// Notify Slack about a new support ticket
export async function notifySlackOfNewTicket(ticketId, username, description, severity) {
  try {
    // Validate the Slack channel and token before sending
    if (!config.SLACK_CHANNEL_ID) {
      logger.error('Slack channel ID not configured. Skipping notification.');
      return;
    }
    
    if (!config.SLACK_API_TOKEN) {
      logger.error('Slack API token not configured. Skipping notification.');
      return;
    }
    
    // Choose emoji based on severity
    let priorityEmoji = '🟢'; // Low/Normal
    let priorityText = severity || 'Normal';
    
    if (severity === 'Medium') {
      priorityEmoji = '🟠';
    } else if (severity === 'High') {
      priorityEmoji = '🔴';
    } else if (severity === 'Urgent') {
      priorityEmoji = '🟡️';
    }
    
    // Truncate long descriptions for Slack message
    const truncatedDescription = description.length > 500 
      ? description.substring(0, 500) + '...' 
      : description;
    
    const payload = {
      channel: config.SLACK_CHANNEL_ID,
      text: `${priorityEmoji} *New ${priorityText} Support Ticket #${ticketId}*\n\n👤 *From:* ${username}\n📝 *Message:* ${truncatedDescription}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${priorityEmoji} *New ${priorityText} Support Ticket #${ticketId}*\n\n👤 *From:* ${username}\n📝 *Message:* ${truncatedDescription}`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "View in Zendesk"
              },
              url: `${config.ZENDESK_API_URL.replace('/api/v2', '')}/agent/tickets/${ticketId}`
            }
          ]
        }
      ]
    };
    
    // Use proper headers to avoid character set warnings
    const response = await axios.post('https://slack.com/api/chat.postMessage', payload, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
      }
    });
    
    logger.info('Slack notification result:', response.data);
    
    if (!response.data.ok) {
      logger.error('Slack API error:', response.data.error);
      
      // Handle specific error cases
      if (response.data.error === 'not_allowed_token_type') {
        logger.error('The Slack token being used appears to be an incorrect type. Please use a bot token starting with xoxb-');
      } else if (response.data.error === 'channel_not_found') {
        logger.error(`Channel ID ${config.SLACK_CHANNEL_ID} not found. Please check your channel ID.`);
      }
    }
    
    return response.data.ok;
  } catch (error) {
    logger.error('Error notifying Slack of new ticket:', error.response?.data || error.message);
    return false;
  }
}