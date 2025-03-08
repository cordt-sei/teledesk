import axios from 'axios';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';

// Initialize DynamoDB client for storing state
const dynamoDB = DynamoDBDocument.from(new DynamoDB());
const ACTIVE_TICKETS_TABLE = process.env.ACTIVE_TICKETS_TABLE;
const USER_STATES_TABLE = process.env.USER_STATES_TABLE;

// Main handler for support ticket messages
export async function handleSupportTicket(ctx) {
    const msg = ctx.message;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const text = msg.text || '';
    
    try {
        // Check if user is in the middle of a flow
        const userStateItem = await getUserState(userId);
        if (userStateItem) {
            return handleUserInFlow(ctx, userId, username, text, userStateItem);
        }
        
        // Check if user has an active ticket
        const activeTicketItem = await getActiveTicket(userId);
        if (activeTicketItem) {
            const ticketId = activeTicketItem.ticketId;
            await addCommentToTicket(ticketId, text, username);
            await ctx.reply("✅ Your message has been added to your support ticket. Our team will respond shortly.");
            return;
        }
        
        // New support message - create a ticket directly
        const ticketId = await createZendeskTicket(text, username, userId);
        await saveActiveTicket(userId, ticketId);
        await ctx.reply(`✅ Support ticket #${ticketId} created. We'll respond as soon as possible. Any further messages you send here will be added to this ticket.`);
        
        // Also notify Slack
        await notifySlackOfNewTicket(ticketId, username, text);
    } catch (error) {
        console.error('Error handling support ticket:', error);
        await ctx.reply("❌ Sorry, there was a problem with your support request. Please try again later.");
    }
}

// Handle user that's in a multi-step flow
async function handleUserInFlow(ctx, userId, username, text, currentState) {
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
            await saveActiveTicket(userId, ticketId);
            await clearUserState(userId);
            
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
            await clearUserState(userId);
            await ctx.reply("❌ Sorry, there was a problem creating your support ticket. Please try again later.");
        }
    }
}

// Create a new Zendesk ticket
async function createZendeskTicket(description, username, userId, severity = 'Normal', severityTag = 'priority_normal') {
    try {
        console.log(`Creating Zendesk ticket for ${username} with severity ${severity}`);
        
        const response = await axios.post(
            `${process.env.ZENDESK_API_URL}/tickets.json`,
            {
                ticket: {
                    subject: severity ? `[${severity}] Support Request from ${username}` : `Support Request from ${username}`,
                    comment: {
                        body: description
                    },
                    requester: {
                        name: username,
                        email: `telegram.${userId}@example.com` // Consider a better approach for production
                    },
                    priority: severity ? severity.toLowerCase() : 'normal',
                    tags: ["telegram", severityTag]
                }
            },
            {
                auth: {
                    username: process.env.ZENDESK_EMAIL,
                    password: process.env.ZENDESK_API_TOKEN
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
            `${process.env.ZENDESK_API_URL}/tickets/${ticketId}.json`,
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
                    username: process.env.ZENDESK_EMAIL,
                    password: process.env.ZENDESK_API_TOKEN
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
        channel: process.env.SLACK_CHANNEL_ID,
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
                        url: `${process.env.ZENDESK_API_URL.replace('/api/v2', '')}/agent/tickets/${ticketId}`
                    }
                ]
            }
        ]
    };

    try {
        await axios.post('https://slack.com/api/chat.postMessage', payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SLACK_API_TOKEN}`
            }
        });
    } catch (error) {
        console.error('Error notifying Slack of new ticket:', error.response?.data || error.message);
    }
}

// DynamoDB functions for state persistence
async function getActiveTicket(userId) {
    try {
        const result = await dynamoDB.get({
            TableName: ACTIVE_TICKETS_TABLE,
            Key: { userId: userId.toString() }
        });
        return result.Item;
    } catch (error) {
        console.error('Error getting active ticket:', error);
        return null;
    }
}

async function saveActiveTicket(userId, ticketId) {
    try {
        await dynamoDB.put({
            TableName: ACTIVE_TICKETS_TABLE,
            Item: {
                userId: userId.toString(),
                ticketId: ticketId,
                createdAt: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error saving active ticket:', error);
        throw error;
    }
}

async function getUserState(userId) {
    try {
        const result = await dynamoDB.get({
            TableName: USER_STATES_TABLE,
            Key: { userId: userId.toString() }
        });
        return result.Item;
    } catch (error) {
        console.error('Error getting user state:', error);
        return null;
    }
}

async function saveUserState(userId, state, description) {
    try {
        await dynamoDB.put({
            TableName: USER_STATES_TABLE,
            Item: {
                userId: userId.toString(),
                state: state,
                description: description,
                updatedAt: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error saving user state:', error);
        throw error;
    }
}

async function clearUserState(userId) {
    try {
        await dynamoDB.delete({
            TableName: USER_STATES_TABLE,
            Key: { userId: userId.toString() }
        });
    } catch (error) {
        console.error('Error clearing user state:', error);
        throw error;
    }
}