import { Telegraf } from 'telegraf';
import axios from 'axios';
import { handleSupportTicket } from './zendesk.js';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';

// Initialize DynamoDB client for storing state
const dynamoDB = DynamoDBDocument.from(new DynamoDB());
const USER_STATES_TABLE = process.env.USER_STATES_TABLE;

// Bot instance setup
let bot;

// Initialize bot with webhook mode
const initializeBot = (token) => {
  if (!bot) {
    bot = new Telegraf(token);
    setupBotHandlers(bot);
  }
  return bot;
};

// Set up all message handlers
const setupBotHandlers = (bot) => {
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
      const isGroupChat = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
      
      // Is this is a team member forwarding a message?
      const isTeamMember = process.env.TEAM_MEMBERS ? 
        process.env.TEAM_MEMBERS.split(',').includes(userId.toString()) : 
        false;
      const isForwarded = msg.forward_from || msg.forward_from_chat;
      
      // Handle request
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
      
      // Is message is from an approved group?
      const isApprovedGroup = process.env.APPROVED_GROUPS ? 
        process.env.APPROVED_GROUPS.split(',').includes(chatId.toString()) : 
        false;

      if (!isTeamMember && isGroupChat && !isApprovedGroup) {
        await ctx.reply("Please send me a direct message to create a support ticket.");
        return;
      }
      
      // Handle messages based on context
      if (isApprovedGroup && isGroupChat) {
        // Group chat support flow - collect info first
        await handleGroupSupportRequest(ctx);
      } else if (!isGroupChat) {
        // Private DM support flow - regular ticket
        await handlePrivateSupportTicket(ctx);
      }
      
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
      const isGroupChat = ctx.message.chat.type === 'group' || ctx.message.chat.type === 'supergroup';
      
      // Check if response to pending forward
      if (pendingForwards.has(userId)) {
        const { originalMessage, forwarder, messageId, chatId } = pendingForwards.get(userId);
        const forwardedFrom = ctx.message.text;

        await sendToSlack(originalMessage, forwarder, forwardedFrom, messageId, chatId);
        await ctx.reply("✅ Message forwarded to Slack!");

        pendingForwards.delete(userId);
        return;
      }
      
      // Check if user is in a group form flow
      const userStateItem = await getUserState(userId);
      if (userStateItem && userStateItem.state && userStateItem.state.startsWith('group_form_')) {
        await handleGroupFormFlow(ctx, userStateItem);
        return;
      }
      
      // Otherwise, handle based on context
      if (isGroupChat) {
        // Group chat support flow
        await handleGroupSupportRequest(ctx);
      } else {
        // Private DM support flow
        await handlePrivateSupportTicket(ctx);
      }
      
    } catch (error) {
      console.error('Error processing text message:', error);
      try {
        await ctx.reply("❌ An error occurred while processing your message.");
      } catch (replyError) {
        console.error('Could not send error message:', replyError);
      }
    }
  });
};

// Function to handle group support requests
async function handleGroupSupportRequest(ctx) {
  const msg = ctx.message;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name;
  
  // Check if user is already in a form flow
  const userStateItem = await getUserState(userId);
  if (userStateItem && userStateItem.state && userStateItem.state.startsWith('group_form_')) {
    return handleGroupFormFlow(ctx, userStateItem);
  }
  
  // Start collection form
  await saveUserState(userId, 'group_form_start', '');
  await ctx.reply(
    `Hi ${username}, I'll need some information to properly escalate this issue:\n\n` +
    `1. Brief description of the issue\n` +
    `2. Priority (Low/Medium/High)\n` +
    `3. Any specific team member to notify\n\n` +
    `Please respond with a description of the issue first.`
  );
}

// Function to handle the group form flow
async function handleGroupFormFlow(ctx, userState) {
  const msg = ctx.message;
  const userId = msg.from.id;
  const text = msg.text || '';
  
  switch(userState.state) {
    case 'group_form_start':
      // Save description
      await saveUserState(userId, 'group_form_priority', text);
      await ctx.reply("Thanks! Please indicate the priority: Low, Medium, or High");
      break;
      
    case 'group_form_priority':
      // Save priority
      const updatedState = {
        ...userState,
        priority: text
      };
      await saveUserState(userId, 'group_form_assignee', userState.description, updatedState);
      await ctx.reply("Is there a specific team member who should handle this?");
      break;
      
    case 'group_form_assignee':
      // Process complete form
      const description = userState.description;
      const priority = userState.priority || 'Low';
      const assignee = text;
      
      // Create flag/alert in Slack
      await sendGroupAlertToSlack(description, priority, assignee, msg.from.username || msg.from.first_name, msg.chat.title);
      
      // Clear user state
      await clearUserState(userId);
      
      await ctx.reply("✅ Your request has been flagged to our team. Someone will follow up shortly.");
      break;
  }
}

// Function to handle private DM tickets
async function handlePrivateSupportTicket(ctx) {
  // This is the regular support ticket flow
  await handleSupportTicket(ctx);
}

// Function to send group alerts to Slack
async function sendGroupAlertToSlack(description, priority, assignee, requester, groupName) {
  let priorityEmoji = '🟢'; // Low
  if (priority.toLowerCase().includes('medium')) priorityEmoji = '🟠';
  if (priority.toLowerCase().includes('high')) priorityEmoji = '🔴';
  
  const payload = {
    channel: process.env.SLACK_CHANNEL_ID,
    text: `${priorityEmoji} *New Group Support Request*\n\n👥 *Group:* ${groupName}\n👤 *From:* ${requester}\n🔍 *Priority:* ${priority}\n👉 *Assignee:* ${assignee || 'Any available team member'}\n📝 *Issue:* ${description}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${priorityEmoji} *New Group Support Request*\n\n👥 *Group:* ${groupName}\n👤 *From:* ${requester}\n🔍 *Priority:* ${priority}\n👉 *Assignee:* ${assignee || 'Any available team member'}\n📝 *Issue:* ${description}`
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "I'll Handle This"
            },
            style: "primary",
            action_id: "handle_group_request",
            value: `group_${Date.now()}`
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
    console.error('Error sending group alert to Slack:', error);
  }
}

// Send a message to Slack
async function sendToSlack(message, forwarder, forwardedFrom, messageId, chatId) {
  const payload = {
    channel: process.env.SLACK_CHANNEL_ID,
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
    // Send to Slack
    const response = await axios.post('https://slack.com/api/chat.postMessage', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SLACK_API_TOKEN}`
      }
    });
    
    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }
    
    const messageTs = response.data.ts;
    
    // Store pending ack with tg chat info
    await savePendingAcknowledgment(messageTs, chatId, messageId, forwarder);

    
    // Indicate message is pending ack
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

// DynamoDB functions for state persistence
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

async function saveUserState(userId, state, description, additionalData = {}) {
  try {
      await dynamoDB.put({
          TableName: USER_STATES_TABLE,
          Item: {
              userId: userId.toString(),
              state: state,
              description: description,
              ...additionalData,
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

async function savePendingAcknowledgment(messageTs, telegramChatId, telegramMessageId, forwarder) {
  try {
    const expirationTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days TTL
    await dynamoDB.put({
      TableName: process.env.SLACK_ACKNOWLEDGMENTS_TABLE,
      Item: {
        messageTs: messageTs,
        telegramChatId: telegramChatId,
        telegramMessageId: telegramMessageId,
        forwarder: forwarder,
        timestamp: Date.now(),
        expirationTime: expirationTime
      }
    });
  } catch (error) {
    console.error('Error saving pending acknowledgment:', error);
    throw error;
  }
}

// Lambda handler function
export const handler = async (event) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    // Initialize bot
    const bot = initializeBot(process.env.TELEGRAM_BOT_TOKEN);
    
    // Process webhook update
    const body = JSON.parse(event.body);
    await bot.handleUpdate(body);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ok' }),
    };
  } catch (error) {
    console.error('Error handling Telegram webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process webhook' }),
    };
  }
};