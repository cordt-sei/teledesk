import axios from 'axios';
import config from './config.js';

// Active support tickets by user ID
const activeTickets = new Map();
// Store user states for multi-step flows
const userState = new Map();

// Main handler for support ticket messages
export async function handleSupportTicket(ctx) {
    const msg = ctx.message;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const text = msg.text || '';
    
    // Check if user is in the middle of a flow
    if (userState.has(userId)) {
        return handleUserInFlow(ctx, userId, username, text);
    }
    
    // If user has an active ticket, add this as a comment
    if (activeTickets.has(userId)) {
        const ticketId = activeTickets.get(userId);
        await addCommentToTicket(ticketId, text, username);
        await ctx.reply("✅ Your message has been added to your support ticket. Our team will respond shortly.");
        return;
    }
    
    // New support message - create a ticket directly
    try {
        const ticketId = await createZendeskTicket(text, username, userId);
        activeTickets.set(userId, ticketId);
        await ctx.reply(`✅ Support ticket #${ticketId} created. We'll respond as soon as possible. Any further messages you send here will be added to this ticket.`);
        
        // Also notify Slack
        await notifySlackOfNewTicket(ticketId, username, text);
    } catch (error) {
        console.error('Error creating ticket:', error);
        await ctx.reply("❌ Sorry, there was a problem creating your support ticket. Please try again later.");
    }
}

// Handle user that's in a multi-step flow
async function handleUserInFlow(ctx, userId, username, text) {
    const currentState = userState.get(userId);
    
    // Handle based on current state
    if (currentState.state === 'awaiting_severity') {
        // Parse severity
        let severity = 'Low';
        let severityTag = 'priority_low';
        
        if (text === '2' || text.toLowerCase().includes('medium')) {
            severity = 'Medium';
            severityTag = 'priority_medium';
        } else if (text === '3' || text.toLowerCase().includes('high')) {
            severity = 'High';
            severityTag = 'priority_high';
        }
        
        try {
            // Create ticket with the gathered information
            const ticketId = await createZendeskTicket(
                currentState.description, 
                username, 
                userId, 
                severity,
                severityTag
            );
            
            // Store the active ticket and clear state
            activeTickets.set(userId, ticketId);
            userState.delete(userId);
            
            // Confirm to user
            await ctx.reply(
                `✅ Your ${severity} priority support ticket #${ticketId} has been created.\n\n` +
                "Our support team has been notified and will respond as soon as possible. " +
                "You can continue to send messages here to add more information to your ticket."
            );
            
            // Also notify on Slack
            await notifySlackOfNewTicket(ticketId, username, currentState.description, severity);
        } catch (error) {
            console.error('Error creating ticket:', error);
            userState.delete(userId);
            await ctx.reply("❌ Sorry, there was a problem creating your support ticket. Please try again later.");
        }
    }
}

// Create a new Zendesk ticket
async function createZendeskTicket(description, username, userId, severity = 'Normal', severityTag = 'priority_normal') {
  try {
      console.log(`Creating Zendesk ticket for ${username} with severity ${severity}`);
      console.log(`Using API URL: ${config.ZENDESK_API_URL}`);
      console.log(`Using email: ${config.ZENDESK_EMAIL || 'Not set!'}`);
      
      // Check if required Zendesk credentials are set
      if (!config.ZENDESK_EMAIL) {
          throw new Error("ZENDESK_EMAIL environment variable is not set");
      }
      
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
                      email: `telegram.${userId}@example.com` // You might want to handle this differently
                  },
                  priority: severity ? severity.toLowerCase() : 'normal',
                  tags: ["telegram", severityTag]
              }
          },
          {
              auth: {
                  username: config.ZENDESK_EMAIL,
                  password: config.ZENDESK_API_TOKEN
              }
          }
      );
      
      console.log(`Zendesk ticket created: ${response.data.ticket.id}`);
      return response.data.ticket.id;
  } catch (error) {
      console.error('Error creating Zendesk ticket:', error);
      console.error('Response data:', error.response?.data);
      console.error('Status:', error.response?.status);
      throw error;
  }
}

// Add a comment to an existing ticket
async function addCommentToTicket(ticketId, comment, username) {
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
                    username: config.ZENDESK_EMAIL,
                    password: config.ZENDESK_API_TOKEN
                }
            }
        );
    } catch (error) {
        console.error('Error adding comment to Zendesk ticket:', error.response?.data || error.message);
        throw error;
    }
}

// Notify Slack about a new support ticket
async function notifySlackOfNewTicket(ticketId, username, description, severity) {
    // Choose emoji based on severity
    let priorityEmoji = '🟢'; // Low/Normal
    let priorityText = severity || 'Normal';
    
    if (severity === 'Medium') {
        priorityEmoji = '🟠';
    } else if (severity === 'High') {
        priorityEmoji = '🔴';
    }
    
    const payload = {
        channel: config.SLACK_CHANNEL_ID,
        text: `${priorityEmoji} *New ${priorityText} Support Ticket #${ticketId}*\n\n👤 *From:* ${username}\n📝 *Message:* ${description}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `${priorityEmoji} *New ${priorityText} Support Ticket #${ticketId}*\n\n👤 *From:* ${username}\n📝 *Message:* ${description}`
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

    try {
        await axios.post('https://slack.com/api/chat.postMessage', payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
            }
        });
    } catch (error) {
        console.error('Error notifying Slack of new ticket:', error.response?.data || error.message);
    }
}