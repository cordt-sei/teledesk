// modules/messageHandlers.js
import { Markup } from 'telegraf';
import axios from 'axios';
import config from '../config.js';
import { 
  getActiveTicket, 
  createZendeskTicket, 
  addCommentToTicket, 
  closeTicket,
  handleSupportTicket,
  searchHelpCenter
} from './zendeskIntegration.js';
import { 
  showMainMenu, 
  showSupportMenu, 
  showForwardInstructions,
  showKnowledgeBaseMenu,
  searchKnowledgeBase
} from './menus.js';
import { sendToSlack } from './slackIntegration.js';
import { MENU, conversationStates, lastBotMessages, pendingSlackAcks } from './state.js';
import createLogger from './logger.js';

// init logger
const logger = createLogger('messageHandlers');

// pending operations stored
export const pendingForwards = new Map();

// clean up bot messages
export async function cleanupPreviousMessages(chatId, bot) {
  const previousMessages = lastBotMessages.get(chatId);
  
  if (previousMessages && previousMessages.length > 0) {
    // remove previous menus/prompts
    for (const msgId of previousMessages) {
      try {
        await bot.telegram.deleteMessage(chatId, msgId);
      } catch (error) {
        // ignore errors for message deletion (most likely too old)
        logger.debug(`Could not delete message ${msgId}: ${error.message}`);
      }
    }
  }
  
  lastBotMessages.delete(chatId);
}

// Handle /start command
export async function handleStart(ctx, bot) {
  try {
    const userId = ctx.from.id;
    const isTeamMember = config.TEAM_MEMBERS.has(userId);
    
    // Clean up previous messages
    await cleanupPreviousMessages(ctx.chat.id, bot);
    
    let welcomeMessage, keyboard;
    
    if (isTeamMember) {
      // Team member welcome
      welcomeMessage = "👋 *Welcome to SEI Helpdesk* \n\n" +
        "As a team member, you can forward messages from other users or groups to Slack.\n\n" + 
        "Forward any message here and it will be relayed to Slack channel for review.";
      
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 How to Forward Messages', 'forward_instructions')],
        [Markup.button.callback('❓ Help / Commands', 'help')]
      ]);
    } else {
      // User welcome
      welcomeMessage = "👋 *Welcome to SEI Helpdesk* \n\n" +
        "You can browse our Knowledge Base for self-help resources or create a support ticket.\n\n" +
        "For the most effective support when creating a ticket:\n\n" +
        "• Be specific about what is happening (or not happening), and in what scenario \n" +
        "• Include any error messages\n" +
        "• Any solutions you've tried\n" +
        "• Specify urgency (Low/Medium/High/Incident)\n\n" +
        "Our team will respond as soon as possible. Thank you!";
      
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📚 Knowledge Base', 'knowledge_base')],
        [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
        [Markup.button.callback('❓ Help / Commands', 'help')]
      ]);
    }
    
    const welcomeMsg = await ctx.reply(welcomeMessage, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    
    // Save message ID for cleanup
    lastBotMessages.set(ctx.chat.id, [welcomeMsg.message_id]);
    
    // Set initial state
    conversationStates.set(userId, { state: isTeamMember ? MENU.FORWARD : MENU.MAIN });
    
  } catch (error) {
    logger.error('Error sending welcome message:', error);
  }
}

// Handle /help command
export async function handleHelp(ctx, bot) {
  try {
    await cleanupPreviousMessages(ctx.chat.id, bot);
    
    const isTeamMember = config.TEAM_MEMBERS.has(ctx.from.id);
    
    let helpText;
    
    if (isTeamMember) {
      // Team help
      helpText = "❓ *SEI Helpdesk Bot Commands (Team Member)*\n\n" +
        "/start - Start or restart the bot\n" +
        "/help - Show this help message\n" +
        "/menu - Show main menu\n\n" +
        "As a team member, this bot helps you forward messages from other users/groups to Slack. " +
        "Simply forward any message to this bot, and it will be relayed to the team Slack channel.";
    } else {
      // User help
      helpText = "❓ *SEI Helpdesk Bot Commands*\n\n" +
        "/start - Start or restart the bot\n" +
        "/menu - Show main menu options\n" +
        "/help - Show this help message\n" +
        "/ticket - Create a new support ticket\n" +
        "/status - Check your active ticket status\n\n" +
        "You can also use the menu buttons below for navigation.";
    }
    
    const helpMsg = await ctx.reply(helpText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('« Back to Main Menu', 'main_menu')]
      ])
    });
    
    lastBotMessages.set(ctx.chat.id, [helpMsg.message_id]);
    conversationStates.set(ctx.from.id, { state: MENU.MAIN });
  } catch (error) {
    logger.error('Error sending help message:', error);
  }
}

// Handle /ticket command
export async function handleTicketCommand(ctx, bot) {
  const userId = ctx.from.id;
  
  // Don't show ticket creation to team members
  if (config.TEAM_MEMBERS.has(userId)) {
    await ctx.reply(
      "As a team member, this bot is primarily for forwarding messages to Slack.\n\n" +
      "If you need to create a support ticket, please use the regular support channels.",
      Markup.inlineKeyboard([
        [Markup.button.callback('🔄 How to Forward Messages', 'forward_instructions')]
      ])
    );
    return;
  }
  
  conversationStates.set(userId, { state: MENU.AWAITING_TICKET_DESCRIPTION });
  
  await cleanupPreviousMessages(ctx.chat.id, bot);
  
  const ticketMsg = await ctx.reply(
    "📝 *New Support Ticket*\n\n" +
    "Please describe your issue in detail. Include any relevant information such as:\n" +
    "• What you were trying to do\n" +
    "• What happened instead\n" +
    "• Any error messages\n" +
    "• Steps you've already taken\n\n" +
    "Your next message will be used to create the ticket.",
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔴 Cancel', 'cancel_ticket')]
      ])
    }
  );
  
  lastBotMessages.set(ctx.chat.id, [ticketMsg.message_id]);
}

// Handle /status command
export async function handleStatusCommand(ctx, bot) {
  const userId = ctx.from.id;
  
  // Don't show ticket context to team members
  if (config.TEAM_MEMBERS.has(userId)) {
    await ctx.reply(
      "As a team member, this bot is primarily for forwarding messages to Slack.\n\n" +
      "If you need to check a support ticket status, please use the regular support channels.",
      Markup.inlineKeyboard([
        [Markup.button.callback('🔄 How to Forward Messages', 'forward_instructions')]
      ])
    );
    return;
  }
  
  await checkTicketStatus(ctx, bot);
}

// Check ticket status
export async function checkTicketStatus(ctx, bot) {
  const userId = ctx.from?.id || ctx.chat.id;
  const ticketInfo = await getActiveTicket(userId);
  
  await cleanupPreviousMessages(ctx.chat.id, bot);
  
  if (ticketInfo) {
    const statusMsg = await bot.telegram.sendMessage(
      ctx.chat.id,
      `🎫 *Ticket #${ticketInfo.id} Status*\n\n` +
      `*Subject:* ${ticketInfo.subject}\n` +
      `*Status:* ${ticketInfo.status}\n` +
      `*Priority:* ${ticketInfo.priority}\n` +
      `*Created:* ${new Date(ticketInfo.created_at).toLocaleString()}\n\n` +
      `Our team is working on your ticket. You'll receive updates here.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 Add Information', 'add_info')],
          [Markup.button.callback('🔍 Check Status', 'check_status')],
          [Markup.button.callback('🟢 Close Ticket', 'close_ticket')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      }
    );
    
    lastBotMessages.set(ctx.chat.id, [statusMsg.message_id]);
  } else {
    const noTicketMsg = await bot.telegram.sendMessage(
      ctx.chat.id,
      "🎫 *No Active Ticket*\n\n" +
      "You don't have any active support tickets. Would you like to create one?",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 Create New Ticket', 'new_ticket')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      }
    );
    
    lastBotMessages.set(ctx.chat.id, [noTicketMsg.message_id]);
  }
  
  conversationStates.set(userId, { state: MENU.SUPPORT });
}

// Handle ticket closing
export async function handleCloseTicket(ctx, bot) {
  const userId = ctx.from?.id || ctx.chat.id;
  const closed = await closeTicket(userId);
  
  await cleanupPreviousMessages(ctx.chat.id, bot);
  
  if (closed) {
    const closedMsg = await bot.telegram.sendMessage(
      ctx.chat.id,
      "🟢 *Ticket Closed*\n\n" +
      "Your support ticket has been marked as resolved. " +
      "Thank you for using SEI Helpdesk! If you need further assistance, you can create a new ticket anytime.",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
          [Markup.button.callback('📚 Knowledge Base', 'knowledge_base')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      }
    );
    
    lastBotMessages.set(ctx.chat.id, [closedMsg.message_id]);
    conversationStates.set(userId, { state: MENU.MAIN });
  } else {
    const errorMsg = await bot.telegram.sendMessage(
      ctx.chat.id,
      "🔴 *Error Closing Ticket*\n\n" +
      "There was an issue closing your ticket. It might be already closed or there was a system error.",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔍 Check Status', 'check_status')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      }
    );
    
    lastBotMessages.set(ctx.chat.id, [errorMsg.message_id]);
  }
}

// handle incoming messages from telegram user
export async function handleMessage(ctx, bot) {
  try {
    const msg = ctx.message;
    const userId = msg.from.id;
    const forwarder = msg.from.username || msg.from.first_name;
    const originalMessage = msg.text || '[Non-text message]';
    const messageId = msg.message_id;
    const chatId = msg.chat.id;
    
    // Check if user is team member
    const isTeamMember = config.TEAM_MEMBERS.has(userId);
    
    // Enhanced logging
    logger.debug('Processing message details:', {
      userId: userId,
      isTeamMember: isTeamMember,
      forwarder: forwarder,
      isForwarded: Boolean(msg.forward_from || msg.forward_from_chat || msg.forward_sender_name || msg.forward_date),
      messageText: msg.text ? msg.text.substring(0, 50) + (msg.text.length > 50 ? '...' : '') : '[non-text]'
    });
    
    // Check if message is forwarded - improved detection
    const isForwarded = Boolean(msg.forward_from || msg.forward_from_chat || msg.forward_sender_name || msg.forward_date);
    
    // Handle team member forwarding message
    if (isTeamMember && isForwarded) {
      // Extract basic source information for logging
      let sourceType = "Unknown";
      let sourceName = "";
      let groupUrl = "";
      
      if (msg.forward_from_chat && msg.forward_from_chat.title) {
        // Group or channel message
        sourceType = msg.forward_from_chat.type === 'channel' ? "Channel" : "Group";
        sourceName = msg.forward_from_chat.title;
        
        // Try to get group username/URL if available
        if (msg.forward_from_chat.username) {
          groupUrl = `https://t.me/${msg.forward_from_chat.username}`;
        }
      } else if (msg.forward_from) {
        // Individual user message
        sourceType = msg.forward_from.is_bot ? "Bot" : "User";
        sourceName = msg.forward_from.username ? 
                   `@${msg.forward_from.username}` : 
                   msg.forward_from.first_name;
      } else if (msg.forward_sender_name) {
        // Private user that doesn't share their info
        sourceType = "User";
        sourceName = msg.forward_sender_name;
      }
      
      logger.info(`Detected forwarded message from ${sourceType}: ${sourceName}`);
      
      // Store the forwarded message info
      pendingForwards.set(userId, { 
        originalMessage, 
        forwarder, 
        messageId, 
        chatId,
        sourceInfo: {
          type: sourceType,
          name: sourceName,
          url: groupUrl
        }
      });
      
      // Simple, intuitive prompt
      const contextPrompt = await ctx.reply(
        `Please provide additional context if required:\n\n - Team / Project name\n - POC\n - Summary of issue`
      );
      
      // Save context prompt message ID for cleanup
      const pendingInfo = pendingForwards.get(userId);
      if (pendingInfo) {
        pendingInfo.contextMsgId = contextPrompt.message_id;
        pendingForwards.set(userId, pendingInfo);
      }
      
      conversationStates.set(userId, { state: MENU.AWAITING_FORWARD_SOURCE });
      return;
    }
    
    // Handle regular message from team member
    if (isTeamMember && !isForwarded) {
      // Check if they're in a specific state first
      const userState = conversationStates.get(userId);
      
      if (userState && userState.state === MENU.AWAITING_FORWARD_SOURCE) {
        if (pendingForwards.has(userId)) {
          const forwardInfo = pendingForwards.get(userId);
          
          // Store the context as provided without parsing
          const context = originalMessage.trim();
          
          // Try to delete the context prompt message
          try {
            if (forwardInfo.contextMsgId) {
              await bot.telegram.deleteMessage(chatId, forwardInfo.contextMsgId);
            }
          } catch (err) {
            logger.debug('Could not delete context prompt message', err);
          }
          
          // Send to Slack with source info and context
          try {
            // Create a simple context object
            const sourceText = forwardInfo.sourceInfo.url ? 
              `${forwardInfo.sourceInfo.type}: ${forwardInfo.sourceInfo.name} (${forwardInfo.sourceInfo.url})` :
              `${forwardInfo.sourceInfo.type}: ${forwardInfo.sourceInfo.name}`;
              
            const contextInfo = {
              source: sourceText,
              context: context
            };
            
            const slackMsgTs = await sendToSlack(
              bot,
              forwardInfo.originalMessage, 
              forwardInfo.forwarder,
              contextInfo,
              forwardInfo.messageId, 
              chatId
            );
            
            logger.info(`Message sent to Slack with timestamp ${slackMsgTs}`);
            
            // No need for additional confirmation - the status message is already sent by sendToSlack
            
            pendingForwards.delete(userId);
            conversationStates.delete(userId);
          } catch (error) {
            logger.error('Error sending to Slack:', error);
            await ctx.reply("Error sending to Slack. Please try again.");
          }
        } else {
          logger.warn(`User ${userId} in awaiting_forward_source state but no pending forward found`);
          await ctx.reply("I couldn't find your previously forwarded message. Please try forwarding again.");
        }
        return;
      } else {
        // Show team menu
        await ctx.reply(
          "To forward a message from a user or group, please use the Telegram forward feature.",
          Markup.inlineKeyboard([
            [Markup.button.callback('🔄 How to Forward Messages', 'forward_instructions')]
          ])
        );
      }
      return;
    }
    
    // Handle regular users below this point
    
    // Check user state for regular users
    const userState = conversationStates.get(userId);
    
    // Handle user states for regular users
    if (userState) {
      switch (userState.state) {
        case MENU.AWAITING_TICKET_DESCRIPTION:
          // Creating a new ticket
          const ticketResult = await handleSupportTicket(ctx);
          if (ticketResult.status === 'choice_required') {
            conversationStates.set(userId, { 
              state: MENU.AWAITING_TICKET_CHOICE,
              message: ticketResult.message,
              severity: ticketResult.severity,
              severityTag: ticketResult.severityTag,
              existingTicketId: ticketResult.existingTicketId
            });
          } else {
            conversationStates.delete(userId);
            
            // Show support menu after ticket creation
            setTimeout(async () => {
              await showSupportMenu(ctx, bot);
            }, 1000);
          }
          return;
          
        case MENU.AWAITING_TICKET_UPDATE:
          // Adding to existing ticket
          await handleSupportTicket(ctx, true);
          conversationStates.delete(userId);
          
          // Show confirmation and support menu
          await ctx.reply("🟢 Information added to your ticket!");
          setTimeout(async () => {
            await showSupportMenu(ctx, bot);
          }, 1000);
          return;
          
        case MENU.SEARCH:
          // search query
          await searchKnowledgeBase(ctx, bot, originalMessage);
          conversationStates.delete(userId);
          return;
      }
    }
    
    // For users without existing workflow, show the main menu
    if (!isTeamMember) {
      await showMainMenu(ctx, bot);
    }
  } catch (error) {
    logger.error('Error processing message:', error);
    try {
      await ctx.reply(
        "🔴 An error occurred while processing your message. Please try again.",
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('« Start Over', 'main_menu')]
          ])
        }
      );
    } catch (replyError) {
      logger.error('Could not send error message:', replyError);
    }
  }
}

// Helper for handling support tickets when user has choice
export async function handleTicketChoice(ctx, choice) {
  const userId = ctx.from.id;
  const userState = conversationStates.get(userId);
  
  if (!userState || userState.state !== MENU.AWAITING_TICKET_CHOICE) {
    await ctx.answerCbQuery('This option is no longer valid.');
    return false;
  }
  
  try {
    await ctx.deleteMessage().catch(() => {});
    
    if (choice === 'add_to_existing') {
      // Add to existing ticket
      await addCommentToTicket(
        userState.existingTicketId,
        userState.message,
        ctx.from.username || ctx.from.first_name || 'Unknown User'
      );
      
      await ctx.reply(
        "🟢 Your message has been added to your existing support ticket.\n\n" +
        "A team member will respond shortly."
      );
    } else {
      // Create new ticket
      const ticketId = await createZendeskTicket(
        userState.message,
        ctx.from.username || ctx.from.first_name || 'Unknown User',
        userId,
        userState.severity,
        userState.severityTag
      );
      
      await ctx.reply(
        `🟢 Your new support ticket (#${ticketId}) has been created with ${userState.severity} priority.\n\n` +
        "A team member will respond shortly."
      );
    }
    
    // Clear the state
    conversationStates.delete(userId);
    return true;
  } catch (error) {
    logger.error(`Error handling ticket choice: ${error}`);
    await ctx.reply("🔴 There was an error processing your request. Please try again.");
    return false;
  }
}

// Handle callback queries
export async function handleCallbackQuery(ctx, bot) {
  try {
    const action = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const isTeamMember = config.TEAM_MEMBERS.has(userId);
    
    // Answer callback to remove loading state
    await ctx.answerCbQuery();
    
    // log callback being processed
    logger.debug(`Processing callback: ${action} for user ${userId}`);
    
    // Redirect team if trying to use ticket-related actions
    if (isTeamMember && ['new_ticket', 'view_ticket', 'close_ticket', 'check_status', 'add_info', 'knowledge_base'].includes(action)) {
      await ctx.deleteMessage();
      await bot.telegram.sendMessage(
        ctx.chat.id,
        "As a team member, this bot is primarily for forwarding messages to Slack.\n\n" +
        "If you need to create a support ticket, please use the regular support channels.",
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 How to Forward Messages', 'forward_instructions')],
            [Markup.button.callback('« Back', 'main_menu')]
          ])
        }
      );
      return;
    }
    
    switch (action) {
      case 'main_menu':
        await showMainMenu(ctx, bot);
        break;
        
      case 'help':
        await handleHelp(ctx, bot);
        break;
      
      case 'knowledge_base':
        await showKnowledgeBaseMenu(ctx, bot);
        break;
        
      case 'search_kb':
        // Set state to search and show search prompt
        conversationStates.set(userId, { state: MENU.SEARCH });
        await ctx.deleteMessage();
        await bot.telegram.sendMessage(
          ctx.chat.id,
          "🔍 *Search Knowledge Base*\n\n" +
          "Please enter your search query below. Type a few keywords related to your question.",
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('« Back to Knowledge Base', 'knowledge_base')]
            ])
          }
        );
        break;
        
      case 'new_ticket':
        // Regular users
        conversationStates.set(userId, { state: MENU.AWAITING_TICKET_DESCRIPTION });
        await ctx.deleteMessage();
        await bot.telegram.sendMessage(
          ctx.chat.id,
          "📝 *New Support Ticket*\n\n" +
          "Please describe your issue in detail. Include any relevant information such as:\n" +
          "• What you were trying to do\n" +
          "• What happened instead\n" +
          "• Any error messages\n" +
          "• Steps you've already taken\n\n" +
          "Your next message will be used to create the ticket.",
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔴 Cancel', 'cancel_ticket')]
            ])
          }
        );
        break;
        
      case 'cancel_ticket':
        conversationStates.delete(userId);
        await ctx.deleteMessage();
        await showMainMenu(ctx, bot);
        break;
        
      case 'view_ticket':
        // Only for regular users
        await checkTicketStatus(ctx, bot);
        break;
        
      case 'forward_instructions':
        await showForwardInstructions(ctx, bot);
        break;
        
      case 'close_ticket':
        // Only for regular users
        await handleCloseTicket(ctx, bot);
        break;
        
      case 'check_status':
        // Only for regular users
        await checkTicketStatus(ctx, bot);
        break;
        
      case 'add_info':
        // non-elevated users only
        conversationStates.set(userId, { state: MENU.AWAITING_TICKET_UPDATE });
        await ctx.deleteMessage();
        await bot.telegram.sendMessage(
          ctx.chat.id,
          "📝 *Add Information to Ticket*\n\n" +
          "Please type your additional information below. This will be added to your existing ticket.",
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔴 Cancel', 'cancel_update')]
            ])
          }
        );
        break;
        
      case 'cancel_update':
        conversationStates.delete(userId);
        await ctx.deleteMessage();
        await showSupportMenu(ctx, bot);
        break;
        
      // Ticket choice callbacks
      case 'add_to_existing':
        await handleTicketChoice(ctx, 'add_to_existing');
        setTimeout(async () => {
          await showSupportMenu(ctx, bot);
        }, 1000);
        break;
        
      case 'create_new_ticket':
        await handleTicketChoice(ctx, 'create_new_ticket');
        setTimeout(async () => {
          await showSupportMenu(ctx, bot);
        }, 1000);
        break;
    }
  } catch (error) {
    logger.error('Error handling callback query:', error);
    await ctx.reply(
      "🔴 An error occurred processing your request. Please try again.",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      }
    );
  }
}