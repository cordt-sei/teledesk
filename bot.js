import { Telegraf } from 'telegraf';
import axios from 'axios';
import config from './config.js';
import { handleSupportTicket } from './zendesk.js';

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
const SLACK_API_TOKEN = config.SLACK_API_TOKEN;
const SLACK_CHANNEL_ID = config.SLACK_CHANNEL_ID;

// Storage for pending operations
const pendingForwards = new Map(); 
export const pendingSlackAcknowledgments = new Map();

// Bot commands
bot.start(async (ctx) => {
  try {
    await ctx.reply(
      "Welcome to SEI Helpdesk 👋\n\n" +
      "Send a brief but detailed description of the issue. " +
      "For the most effective support:\n\n" +
      "• Be specific about what is happening (or not happening), and in what scenario \n" +
      "• Include any error messages\n" +
      "• Any solutions you've tried\n" +
      "• Specify urgency (Low/Medium/High/Incident)\n\n" +
      "Our team will respond as soon as possible. Thank you!"
    );
  } catch (error) {
    console.error('Error sending welcome message:', error);
  }
});

// incoming message handler
bot.on('message', async (ctx) => {
    try {
        const msg = ctx.message;
        const userId = msg.from.id;
        const forwarder = msg.from.username || msg.from.first_name;
        const originalMessage = msg.text || '[Non-text message]';
        const messageId = msg.message_id;
        const chatId = msg.chat.id;
        
        console.log('User ID:', userId, 'Type:', typeof userId);
        console.log('Is in team members:', config.TEAM_MEMBERS.has(userId));
        console.log('Team members contains:', [...config.TEAM_MEMBERS]);

        // check if user is team member
        const isTeamMember = config.TEAM_MEMBERS.has(userId);
        
        // inspect all possible forwarded message fields
        const isForwarded = msg.forward_from || 
                          msg.forward_from_chat || 
                          msg.forward_sender_name || 
                          msg.forward_date;
        
        console.log('Is forwarded message:', !!isForwarded);
        console.log('Message forward properties:', { 
            forward_from: msg.forward_from,
            forward_from_chat: msg.forward_from_chat,
            forward_sender_name: msg.forward_sender_name,
            forward_date: msg.forward_date
        });
        
        // handle team member forwarded messages
        if (isTeamMember && isForwarded) {
            // Attempt to determine the original source or chat
            let forwardedFrom = null;
            
            if (msg.forward_from_chat && msg.forward_from_chat.title) {
                // Group or channel message
                forwardedFrom = msg.forward_from_chat.title;
            } else if (msg.forward_from) {
                // Individual user message
                forwardedFrom = msg.forward_from.username || 
                              msg.forward_from.first_name || 
                              'Private User';
            } else if (msg.forward_sender_name) {
                // Private user that doesn't share their info
                forwardedFrom = msg.forward_sender_name;
            }
            
            if (!forwardedFrom) {
                await ctx.reply("🔹 Please indicate the group, or the team/user this message is from:");
                pendingForwards.set(userId, { originalMessage, forwarder, messageId, chatId });
            } else {
                await sendToSlack(originalMessage, forwarder, forwardedFrom, messageId, chatId);
                await ctx.reply("✅ Message forwarded to Slack!");
            }
            return;
        }
        
        // All other messages treated as support tickets
        await handleSupportTicket(ctx);
    } catch (error) {
        console.error('Error processing message:', error);
        try {
            await ctx.reply("❌ An error occurred while processing your message.");
        } catch (replyError) {
            console.error('Could not send error message:', replyError);
        }
    }
});

// Text message handler (handles replies to bot prompts)
bot.on('text', async (ctx) => {
    try {
        const userId = ctx.message.from.id;
        
        // Handle responses to pending forward requests
        if (pendingForwards.has(userId)) {
            const { originalMessage, forwarder, messageId, chatId } = pendingForwards.get(userId);
            const forwardedFrom = ctx.message.text;

            await sendToSlack(originalMessage, forwarder, forwardedFrom, messageId, chatId);
            await ctx.reply("✅ Message forwarded to Slack!");
            pendingForwards.delete(userId);
            return;
        }
        
        // Default to support ticket
        await handleSupportTicket(ctx);
    } catch (error) {
        console.error('Error processing text message:', error);
        try {
            await ctx.reply("❌ An error occurred while processing your message.");
        } catch (replyError) {
            console.error('Could not send error message:', replyError);
        }
    }
});

// Send message to Slack with acknowledgment button
async function sendToSlack(message, forwarder, forwardedFrom, messageId, chatId) {
    const payload = {
        channel: SLACK_CHANNEL_ID,
        text: `📢 *Forwarded Message*\n\n📌 *From:* ${forwarder}\n🏷 *Group:* ${forwardedFrom || 'Unknown'}\n📝 *Message:* ${message}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `📢 *Forwarded Message*\n\n📌 *From:* ${forwarder}\n🏷 *Group:* ${forwardedFrom || 'Unknown'}\n📝 *Message:* ${message}`
                }
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: "Acknowledge"
                        },
                        style: "primary",
                        action_id: "acknowledge_forward",
                        value: `ack_${Date.now()}`
                    }
                ]
            }
        ]
    };

    try {
        const response = await axios.post('https://slack.com/api/chat.postMessage', payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SLACK_API_TOKEN}`
            }
        });
        
        if (!response.data.ok) {
            throw new Error(`Slack API error: ${response.data.error}`);
        }
        
        const messageTs = response.data.ts;
        
        // Store pending acknowledgment info
        pendingSlackAcknowledgments.set(messageTs, {
            telegramChatId: chatId,
            telegramMessageId: messageId,
            forwarder,
            timestamp: Date.now()
        });
        
        await bot.telegram.sendMessage(
            chatId,
            "✅ Message forwarded to Slack - status will update upon acknowledgment from the team."
        );

        return messageTs;
    } catch (error) {
        console.error('Error sending to Slack:', error.response?.data || error.message);
        throw error;
    }
}

// Helper function for webhook server to send acknowledgments
export function sendTelegramAcknowledgment(chatId, message) {
    return bot.telegram.sendMessage(chatId, message);
}

// Bot initialization
async function startBot() {
    try {
        console.log('Clearing webhook and pending updates...');
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('Starting bot with custom polling parameters...');
        await bot.launch({
            polling: {
                timeout: 10,
                limit: 100,
                allowedUpdates: ['message', 'callback_query'],
            },
            dropPendingUpdates: true
        });
        
        console.log(`Bot is ready.. (Environment: ${config.DEPLOY_ENV || 'development'})`);
    } catch (err) {
        console.error('Failed to start bot:', err);
    }
}

// Only start the bot when explicitly enabled
if (process.env.BOT_PROCESS === 'true') {
    startBot();
}
  
// Graceful shutdown
process.once('SIGINT', () => {
    if (process.env.BOT_PROCESS === 'true') {
        bot.stop('SIGINT');
    }
});
process.once('SIGTERM', () => {
    if (process.env.BOT_PROCESS === 'true') {
        bot.stop('SIGTERM');
    }
});