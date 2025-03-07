import { Telegraf } from 'telegraf';
import axios from 'axios';
import config from './config.js';

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

const SLACK_API_TOKEN = config.SLACK_API_TOKEN;
const SLACK_CHANNEL_ID = config.SLACK_CHANNEL_ID;

// pending forwards temp storage
const pendingForwards = new Map(); 

bot.on('message', async (ctx) => {
    try {
        const msg = ctx.message;
        const userId = msg.from.id;
        const forwarder = msg.from.username || msg.from.first_name;
        const originalMessage = msg.text || '[Non-text message]';
        const messageId = msg.message_id;
        const chatId = msg.chat.id;

        let forwardedFrom = msg.forward_from_chat ? msg.forward_from_chat.title : null;

        if (config.TEAM_MEMBERS.has(userId)) {
            if (msg.forward_from || msg.forward_from_chat) {
                if (!forwardedFrom) {
                    await ctx.reply("🔹 I couldn't determine the original group. Please enter the name of the group this message was forwarded from:");
                    
                    // Store message data for later reference
                    pendingForwards.set(userId, { originalMessage, forwarder, messageId, chatId });

                } else {
                    await sendToSlack(originalMessage, forwarder, forwardedFrom, messageId, chatId);
                    await ctx.reply("Message forwarded to Slack!");
                }
            }
        }
    } catch (error) {
        console.error('Error processing message:', error);
        try {
            await ctx.reply("An error occurred while processing your message.");
        } catch (replyError) {
            console.error('Could not send error message:', replyError);
        }
    }
});

bot.on('text', async (ctx) => {
    try {
        const userId = ctx.message.from.id;
        if (pendingForwards.has(userId)) {
            const { originalMessage, forwarder, messageId, chatId } = pendingForwards.get(userId);
            const forwardedFrom = ctx.message.text;

            await sendToSlack(originalMessage, forwarder, forwardedFrom, messageId, chatId);
            await ctx.reply("Message forwarded to Slack!");

            pendingForwards.delete(userId); // Clear stored message after use
        }
    } catch (error) {
        console.error('Error processing text message:', error);
        try {
            await ctx.reply("An error occurred while processing your message.");
        } catch (replyError) {
            console.error('Could not send error message:', replyError);
        }
    }
});

async function sendToSlack(message, forwarder, forwardedFrom, messageId, chatId) {
  const payload = {
      channel: SLACK_CHANNEL_ID,
      text: `📢 *Forwarded Message*\n\n📌 *From:* ${forwarder}\n🏷 *Group:* ${forwardedFrom || 'Unknown'}\n📝 *Message:* ${message}`
  };

  try {
      // Send message to Slack
      const response = await axios.post('https://slack.com/api/chat.postMessage', payload, {
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SLACK_API_TOKEN}`
          }
      });
      
      if (!response.data.ok) {
          throw new Error(`Slack API error: ${response.data.error}`);
      }
      
      // Add reaction to the message (green checkmark)
      const messageTs = response.data.ts;
      await axios.post('https://slack.com/api/reactions.add', {
          channel: SLACK_CHANNEL_ID,
          name: 'white_check_mark',
          timestamp: messageTs
      }, {
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SLACK_API_TOKEN}`
          }
      });
      
      return true;
  } catch (error) {
      console.error('Error sending to Slack:', error.response?.data || error.message);
      throw error;
  }
}

// Start the bot
bot.launch().then(() => {
    console.log(`Bot is ready.. (Environment: ${config.DEPLOY_ENV || 'development'})`);
}).catch(err => {
    console.error('Failed to start bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));