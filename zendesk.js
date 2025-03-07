import axios from 'axios';
import config from './config.js';

// Active support tickets by user ID
const activeTickets = new Map();

// Handle direct messages for support tickets
export async function handleSupportMessage(ctx) {
    const msg = ctx.message;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const text = msg.text || '';

    // If user has an active ticket, add this as a comment
    if (activeTickets.has(userId)) {
        const ticketId = activeTickets.get(userId);
        await addCommentToTicket(ticketId, text, username);
        await ctx.reply("✅ Your message has been added to your support ticket. Our team will respond shortly.");
        return;
    }

    // New support request
    if (text.toLowerCase().includes('help') || text.toLowerCase().includes('support')) {
        await ctx.reply("I'll create a support ticket for you. Please describe your issue in detail.");
        // Set user in a "waiting for description" state
        activeTickets.set(userId, 'pending');
        return;
    }

    // If user is in pending state, create the ticket with their message
    if (activeTickets.get(userId) === 'pending') {
        const ticketId = await createZendeskTicket(text, username, userId);
        activeTickets.set(userId, ticketId);
        await ctx.reply(`✅ Support ticket #${ticketId} created. We'll respond as soon as possible.`);
        
        // Also notify on Slack
        await notifySlackOfNewTicket(ticketId, username, text);
        return;
    }

    // Default response for direct messages
    await ctx.reply("Hello! If you need support, please type 'help' or 'support' to create a ticket.");
}

// Create a new Zendesk ticket
async function createZendeskTicket(description, username, userId) {
    try {
        const response = await axios.post(
            `${config.ZENDESK_API_URL}/tickets.json`,
            {
                ticket: {
                    subject: `Support Request from ${username}`,
                    comment: {
                        body: description
                    },
                    requester: {
                        name: username,
                        email: `telegram.${userId}@example.com` // You might want to handle this differently
                    },
                    tags: ["telegram"]
                }
            },
            {
                auth: {
                    username: config.ZENDESK_EMAIL,
                    password: config.ZENDESK_API_TOKEN
                }
            }
        );
        
        return response.data.ticket.id;
    } catch (error) {
        console.error('Error creating Zendesk ticket:', error.response?.data || error.message);
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
async function notifySlackOfNewTicket(ticketId, username, description) {
    const payload = {
        channel: config.SLACK_CHANNEL_ID,
        text: `🎫 *New Support Ticket #${ticketId}*\n\n👤 *From:* ${username}\n📝 *Message:* ${description}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `🎫 *New Support Ticket #${ticketId}*\n\n👤 *From:* ${username}\n📝 *Message:* ${description}`
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