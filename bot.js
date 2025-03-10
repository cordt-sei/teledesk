import { Telegraf } from 'telegraf';
import axios from 'axios';
import config from './config.js';
import { handleSupportTicket } from './zendesk.js';

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

const SLACK_API_TOKEN = config.SLACK_API_TOKEN;
const SLACK_CHANNEL_ID = config.SLACK_CHANNEL_ID;

// pending forwards temp storage
const pendingForwards = new Map(); 

// messages with pending acknowledgements
export const pendingSlackAcknowledgments = new Map();

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

bot.on('message', async (ctx) => {
    try {
        const msg = ctx.message;
        const userId = msg.from.id;
        const forwarder = msg.from.username || msg.from.first_name;
        const originalMessage = msg.text || '[Non-text message]';
        const messageId = msg.message_id;
        const chatId = msg.chat.id;
        
        // if forwarded message from SEI team members
        const isTeamMember = config.TEAM_MEMBERS.has(userId);
        const isForwarded = msg.forward_from || msg.forward_from_chat;
        
        // prompt for additional info and relay to slack channel
        if (isTeamMember && isForwarded) {
            let forwardedFrom = msg.forward_from_chat ? msg.forward_from_chat.title : null;
            
            if (!forwardedFrom) {
                await ctx.reply("🔹 I couldn't determine the original group. Please enter the name of the group this message was forwarded from:");
                
                // Store message data for later reference
                pendingForwards.set(userId, { originalMessage, forwarder, messageId, chatId });
            } else {
                await sendToSlack(originalMessage, forwarder, forwardedFrom, messageId, chatId);
                await ctx.reply("✅ Message forwarded to Slack!");
            }
            return;
        }
        
        // all other cases are treated as support ticket
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

bot.on('text', async (ctx) => {
    try {
        const userId = ctx.message.from.id;
        
        // check if response to pending forward
        if (pendingForwards.has(userId)) {
            const { originalMessage, forwarder, messageId, chatId } = pendingForwards.get(userId);
            const forwardedFrom = ctx.message.text;

            await sendToSlack(originalMessage, forwarder, forwardedFrom, messageId, chatId);
            await ctx.reply("✅ Message forwarded to Slack!");

            pendingForwards.delete(userId);
            return;
        }
        
        // Otherwise, handle as support message
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
        // send to Slack
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
        
        // store pending ack with tg chat info
        pendingSlackAcknowledgments.set(messageTs, {
            telegramChatId: chatId,
            telegramMessageId: messageId,
            forwarder,
            timestamp: Date.now()
        });
        
        // indicate message is pending ack
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

// Start the bot with improved error handling and webhook cleanup
async function startBot() {
    try {
        // Clear any existing webhooks with dropping pending updates
        console.log('Clearing webhook and pending updates...');
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        
        // Wait a moment to ensure Telegram registers the change
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Start with specific polling parameters
        console.log('Starting bot with custom polling parameters...');
        await bot.launch({
            polling: {
                timeout: 10,  // Use a shorter timeout
                limit: 100,   // Process more updates at once
                allowedUpdates: ['message', 'callback_query'], // Only get updates we need
            },
            dropPendingUpdates: true
        });
        
        console.log(`Bot is ready.. (Environment: ${config.DEPLOY_ENV || 'development'})`);
    } catch (err) {
        console.error('Failed to start bot:', err);
    }
}

// Start the bot with our custom method
startBot();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

export { bot };