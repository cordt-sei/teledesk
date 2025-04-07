// modules/messageHandlers.js
import { Markup } from 'telegraf';
import config from '../config.js';
import { 
  getActiveTicket, 
  createZendeskTicket, 
  addCommentToTicket, 
  closeTicket,
  reopenTicket,
  handleSupportTicket
} from './zendeskIntegration.js';
import { 
  showMainMenu, 
  showSupportMenu, 
  showForwardInstructions,
  showKnowledgeBaseMenu,
  showKnowledgeBaseCategories,
  showCategorySections,
  showSectionArticles,
  showArticleDetails,
  showFullArticleInTelegram,
  processKnowledgeBaseSearch
} from './menus.js';
import { sendToSlack } from './slackIntegration.js';
import { 
  MENU, 
  conversationStates, 
  updateUserState, 
  hasStateExpired
} from './state.js';
import MessageManager from './messageManager.js';
import createLogger from './logger.js';

// Initialize logger
const logger = createLogger('messageHandlers');

// Storage for pending operations
export const pendingForwards = new Map();

// Handle /start command
export async function handleStart(ctx, bot) {
  try {
    const userId = ctx.from.id;
    const isTeamMember = config.TEAM_MEMBERS.has(userId);
    
    // Clean up previous messages
    await MessageManager.clearPreviousMessages(ctx.chat.id, bot, ctx);
    
    let welcomeMessage, keyboard;
    
    if (isTeamMember) {
      // Team member welcome
      welcomeMessage = '👋 *Welcome to SEI Helpdesk* \n\n' +
        'As a team member, you can forward messages from other users or groups to Slack.\n\n' + 
        'Forward any message here and it will be relayed to Slack channel for review.';
      
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 How to Forward Messages', 'forward_instructions')],
        [Markup.button.callback('❓ Help / Commands', 'help')]
      ]);
    } else {
      // User welcome
      welcomeMessage = '👋 *Welcome to SEI Helpdesk* \n\n' +
        'You can browse our Knowledge Base for self-help resources or create a support ticket.\n\n' +
        'For the most effective support when creating a ticket:\n\n' +
        '• Be specific about what is happening (or not happening), and in what scenario \n' +
        '• Include any error messages\n' +
        "• Any solutions you've tried\n" +
        '• Specify urgency (Low/Medium/High/Incident)\n\n' +
        'Our team will respond as soon as possible. Thank you!';
      
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📚 Knowledge Base', 'knowledge_base')],
        [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
        [Markup.button.callback('❓ Help / Commands', 'help')]
      ]);
    }
    
    // Send welcome message and store its ID
    await MessageManager.sendMessage(
      ctx.chat.id,
      welcomeMessage, 
      {
        parse_mode: 'Markdown',
        ...keyboard
      },
      bot
    );
    
    // Set initial state with activity timestamp
    updateUserState(userId, isTeamMember ? MENU.FORWARD : MENU.MAIN);
    
  } catch (error) {
    logger.error('Error sending welcome message:', error);
  }
}

// Handle /help command
export async function handleHelp(ctx, bot) {
  try {
    await MessageManager.clearPreviousMessages(ctx.chat.id, bot, ctx);
    
    const userId = ctx.from.id;
    const isTeamMember = config.TEAM_MEMBERS.has(userId);
    
    let helpText;
    
    if (isTeamMember) {
      // Team help
      helpText = '❓ *SEI Helpdesk Bot Commands (Team Member)*\n\n' +
        '/start - Start or restart the bot\n' +
        '/help - Show this help message\n' +
        '/menu - Show main menu\n\n' +
        'As a team member, this bot helps you forward messages from other users/groups to Slack. ' +
        'Simply forward any message to this bot, and it will be relayed to the team Slack channel.';
    } else {
      // User help
      helpText = '❓ *SEI Helpdesk Bot Commands*\n\n' +
        '/start - Start or restart the bot\n' +
        '/menu - Show main menu options\n' +
        '/help - Show this help message\n' +
        '/ticket - Create a new support ticket\n' +
        '/status - Check your active ticket status\n\n' +
        'You can also use the menu buttons below for navigation.';
    }
    
    await MessageManager.sendMessage(
      ctx.chat.id,
      helpText,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      },
      bot
    );
    
    // Update user state
    updateUserState(userId, MENU.MAIN);
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
      'As a team member, this bot is primarily for forwarding messages to Slack.\n\n' +
      'If you need to create a support ticket, please use the regular support channels.',
      Markup.inlineKeyboard([
        [Markup.button.callback('🔄 How to Forward Messages', 'forward_instructions')]
      ])
    );
    return;
  }
  
  await MessageManager.clearPreviousMessages(ctx.chat.id, bot, ctx);
  
  await MessageManager.sendMessage(
    ctx.chat.id,
    '📝 *New Support Ticket*\n\n' +
    'Please describe your issue in detail. Include any relevant information such as:\n' +
    '• What you were trying to do\n' +
    '• What happened instead\n' +
    '• Any error messages\n' +
    "• Steps you've already taken\n\n" +
    'Your next message will be used to create the ticket.',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔴 Cancel', 'cancel_ticket')]
      ])
    },
    bot
  );
  
  // Update user state
  updateUserState(userId, MENU.AWAITING_TICKET_DESCRIPTION);
}

// Handle /status command
export async function handleStatusCommand(ctx, bot) {
  const userId = ctx.from.id;
  
  // Don't show ticket context to team members
  if (config.TEAM_MEMBERS.has(userId)) {
    await ctx.reply(
      'As a team member, this bot is primarily for forwarding messages to Slack.\n\n' +
      'If you need to check a support ticket status, please use the regular support channels.',
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
  
  await MessageManager.clearPreviousMessages(ctx.chat.id, bot, ctx);
  
  if (ticketInfo) {
    // Determine if ticket is closed
    const isClosed = ticketInfo.status === 'closed' || ticketInfo.status === 'solved';
    
    // Build appropriate buttons based on ticket status
    const buttons = [];
    
    if (!isClosed) {
      buttons.push([Markup.button.callback('📝 Add Information', 'add_info')]);
      buttons.push([Markup.button.callback('🔍 Check Status', 'check_status')]);
      buttons.push([Markup.button.callback('🟢 Close Ticket', 'close_ticket')]);
    } else {
      buttons.push([Markup.button.callback('🔄 Reopen Ticket', 'reopen_ticket')]);
    }
    
    // Always add a back button
    buttons.push([Markup.button.callback('« Back to Main Menu', 'main_menu')]);
    
    await MessageManager.sendMessage(
      ctx.chat.id,
      `🎫 *Ticket #${ticketInfo.id} Status*\n\n` +
      `*Subject:* ${ticketInfo.subject}\n` +
      `*Status:* ${ticketInfo.status}\n` +
      `*Priority:* ${ticketInfo.priority}\n` +
      `*Created:* ${new Date(ticketInfo.created_at).toLocaleString()}\n\n` +
      `${!isClosed ? 'Our team is working on your ticket. You\'ll receive updates here.' : 'This ticket is currently closed. You can reopen it if needed.'}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      },
      bot
    );
    
    // Update user state
    updateUserState(userId, MENU.SUPPORT);
  } else {
    await MessageManager.sendMessage(
      ctx.chat.id,
      '🎫 *No Active Ticket*\n\n' +
      "You don't have any active support tickets. Would you like to create one?",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 Create New Ticket', 'new_ticket')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      },
      bot
    );
    
    // Update user state
    updateUserState(userId, MENU.SUPPORT);
  }
}

// Handle ticket closing
export async function handleCloseTicket(ctx, bot) {
  const userId = ctx.from?.id || ctx.chat.id;
  const closed = await closeTicket(userId);
  
  await MessageManager.clearPreviousMessages(ctx.chat.id, bot, ctx);
  
  if (closed) {
    await MessageManager.sendMessage(
      ctx.chat.id,
      '🟢 *Ticket Closed*\n\n' +
      'Your support ticket has been marked as resolved. ' +
      'Thank you for using SEI Helpdesk! If you need further assistance, you can create a new ticket anytime.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
          [Markup.button.callback('📚 Knowledge Base', 'knowledge_base')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      },
      bot
    );
    
    // Update user state
    updateUserState(userId, MENU.MAIN);
  } else {
    await MessageManager.sendMessage(
      ctx.chat.id,
      '🔴 *Error Closing Ticket*\n\n' +
      'There was an issue closing your ticket. It might be already closed or there was a system error.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔍 Check Status', 'check_status')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      },
      bot
    );
  }
}

// Handle ticket reopening
export async function handleReopenTicket(ctx, bot) {
  const userId = ctx.from?.id || ctx.chat.id;
  const reopened = await reopenTicket(userId);
  
  await MessageManager.clearPreviousMessages(ctx.chat.id, bot, ctx);
  
  if (reopened) {
    await MessageManager.sendMessage(
      ctx.chat.id,
      '🟢 *Ticket Reopened*\n\n' +
      'Your support ticket has been reopened and our team will continue working on it. ' +
      "You'll receive updates here.",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 Add Information', 'add_info')],
          [Markup.button.callback('🔍 Check Status', 'check_status')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      },
      bot
    );
    
    // Update user state
    updateUserState(userId, MENU.SUPPORT);
  } else {
    await MessageManager.sendMessage(
      ctx.chat.id,
      '🔴 *Error Reopening Ticket*\n\n' +
      'There was an issue reopening your ticket. It might already be active or there was a system error.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔍 Check Status', 'check_status')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      },
      bot
    );
  }
}

// handle incoming messages from telegram user
export async function handleMessage(ctx, bot) {
  try {
    // Track and extract basic info
    MessageManager.trackUserMessage(ctx);
    const msg = ctx.message;
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const originalMessage = msg.text || '[Non-text message]';
    const isTeamMember = config.TEAM_MEMBERS.has(userId);
    const isForwarded = Boolean(
      msg.forward_from || msg.forward_from_chat || msg.forward_sender_name || msg.forward_date
    );

    // Enhanced logging
    logger.debug('Processing message', {
      userId,
      isTeamMember,
      forwarder: msg.from.username || msg.from.first_name,
      isForwarded,
      messageSnippet: originalMessage.slice(0, 50) + (originalMessage.length > 50 ? '…' : '')
    });

    // 1) Handle expired user state
    if (hasStateExpired(userId)) {
      await resetExpiredState(userId, chatId, isTeamMember, bot);
      return;
    }

    // 2) Team member forwarded message
    if (isTeamMember && isForwarded) {
      await handleTeamForward(ctx, bot, userId, originalMessage, msg);
      return;
    }

    // 3) Team member non-forwarded message
    if (isTeamMember && !isForwarded) {
      await handleTeamChat(ctx, bot, userId);
      return;
    }

    // 4) Regular user states
    const userState = conversationStates.get(userId);
    if (userState) {
      switch (userState.state) {
        case MENU.AWAITING_TICKET_DESCRIPTION: {
          const ticketResult = await handleSupportTicket(ctx);
          if (ticketResult.status === 'choice_required') {
            updateUserState(userId, MENU.AWAITING_TICKET_CHOICE, {
              message: ticketResult.message,
              severity: ticketResult.severity,
              severityTag: ticketResult.severityTag,
              existingTicketId: ticketResult.existingTicketId
            });
          } else {
            conversationStates.delete(userId);
            setTimeout(() => showSupportMenu(ctx, bot), 1000);
          }
          return;
        }

        case MENU.AWAITING_TICKET_UPDATE: {
          await handleSupportTicket(ctx, true);
          conversationStates.delete(userId);
          await ctx.reply('🟢 Information added to your ticket!');
          setTimeout(() => showSupportMenu(ctx, bot), 1000);
          return;
        }

        case MENU.SEARCH: {
          await processKnowledgeBaseSearch(ctx, bot, originalMessage);
          conversationStates.delete(userId);
          return;
        }

        default:
          break;
      }
    }

    // 5) Fallback: show main menu for regular users
    if (!isTeamMember) {
      await showMainMenu(ctx, bot);
    }
  } catch (error) {
    logger.error('Error processing message:', error);
    try {
      await ctx.reply('🔴 An error occurred. Please try again.', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Start Over', 'main_menu')]])
      });
    } catch (replyErr) {
      logger.error('Reply failed:', replyErr);
    }
  }
}

// Helper to reset expired state logic (replace or remove if you have existing)
async function resetExpiredState(userId, chatId, isTeamMember, bot) {
  logger.info(`User ${userId} state expired, resetting`);
  const activeTicket = await getActiveTicket(userId);
  if (!isTeamMember) {
    const text = `👋 *Welcome back to SEI Helpdesk*\n\n${
      activeTicket
        ? `You have an active ticket (#${activeTicket.id}). You can check its status or create a new one.`
        : 'How can we help you today?'
    }`;
    const buttons = [
      [Markup.button.callback('📚 Knowledge Base', 'knowledge_base')],
      activeTicket
        ? [Markup.button.callback('🔍 Check Ticket Status', 'view_ticket')]
        : [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
      [Markup.button.callback('❓ Help / Commands', 'help')]
    ];
    await MessageManager.sendMessage(chatId, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }, bot);
    updateUserState(userId, MENU.MAIN);
  }
}

// Helper to handle forwarded messages from team members
async function handleTeamForward(ctx, bot, userId, originalMessage, msg) {
  const { sourceInfo } = await parseForwardSource(msg);
  pendingForwards.set(userId, {
    originalMessage,
    forwarder: msg.from.username || msg.from.first_name,
    messageId: msg.message_id,
    chatId: msg.chat.id,
    sourceInfo
  });
  const prompt = await ctx.reply(
    `Please provide additional context if required:\n\n - Team / Project name\n - POC\n - Summary of issue`
  );
  pendingForwards.get(userId).contextMsgId = prompt.message_id;
  updateUserState(userId, MENU.AWAITING_FORWARD_SOURCE);
}

// Helper to handle team chats when not forwarding
async function handleTeamChat(ctx, bot, userId) {
  const state = conversationStates.get(userId);
  if (state && state.state === MENU.AWAITING_FORWARD_SOURCE) {
    await finalizeForward(ctx, bot, userId);
  } else {
    await MessageManager.sendMessage(
      ctx.chat.id,
      'To forward a message from a user or group, please use the Telegram forward feature.',
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔄 How to Forward Messages', 'forward_instructions')]]) },
      bot
    );
    updateUserState(userId, MENU.FORWARD);
  }
}

// Helper to parse forwarded message source info
async function parseForwardSource(msg) {
  let sourceType = 'Unknown';
  let sourceName = '';
  let groupUrl = '';

  if (msg.forward_from_chat && msg.forward_from_chat.title) {
    sourceType = msg.forward_from_chat.type === 'channel' ? 'Channel' : 'Group';
    sourceName = msg.forward_from_chat.title;
    if (msg.forward_from_chat.username) {
      groupUrl = `https://t.me/${msg.forward_from_chat.username}`;
    }
  } else if (msg.forward_from) {
    sourceType = msg.forward_from.is_bot ? 'Bot' : 'User';
    sourceName = msg.forward_from.username ? `@${msg.forward_from.username}` : msg.forward_from.first_name;
  } else if (msg.forward_sender_name) {
    sourceType = 'User';
    sourceName = msg.forward_sender_name;
  }

  return { sourceInfo: { type: sourceType, name: sourceName, url: groupUrl } };
}

// Helper to finalize forward: get context, send to Slack, cleanup
async function finalizeForward(ctx, bot, userId) {
  const forwardInfo = pendingForwards.get(userId);
  if (!forwardInfo) return;

  // delete the context prompt
  if (forwardInfo.contextMsgId) {
    try {
      await bot.telegram.deleteMessage(forwardInfo.chatId, forwardInfo.contextMsgId);
    } catch (err) {
      logger.debug('Could not delete context prompt message', err);
    }
  }

  // send to Slack
  const sourceText = forwardInfo.sourceInfo.url
    ? `${forwardInfo.sourceInfo.type}: ${forwardInfo.sourceInfo.name} (${forwardInfo.sourceInfo.url})`
    : `${forwardInfo.sourceInfo.type}: ${forwardInfo.sourceInfo.name}`;
  const contextText = ctx.message.text.trim();

  try {
    const slackMsgTs = await sendToSlack(
      bot,
      forwardInfo.originalMessage,
      forwardInfo.forwarder,
      { source: sourceText, context: contextText },
      forwardInfo.messageId,
      forwardInfo.chatId
    );
    logger.info(`Message sent to Slack with timestamp ${slackMsgTs}`);
  } catch (error) {
    logger.error('Error sending to Slack:', error);
    await ctx.reply('Error sending to Slack. Please try again.');
  }

  // cleanup
  pendingForwards.delete(userId);
  conversationStates.delete(userId);
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
        '🟢 Your message has been added to your existing support ticket.\n\n' +
        'A team member will respond shortly.'
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
        'A team member will respond shortly.'
      );
    }
    
    // Clear the state
    conversationStates.delete(userId);
    return true;
  } catch (error) {
    logger.error(`Error handling ticket choice: ${error}`);
    await ctx.reply('🔴 There was an error processing your request. Please try again.');
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
    if (isTeamMember && ['new_ticket', 'view_ticket', 'close_ticket', 'check_status', 'add_info', 'knowledge_base', 'reopen_ticket'].includes(action)) {
      await ctx.deleteMessage();
      await MessageManager.sendMessage(
        ctx.chat.id,
        'As a team member, this bot is primarily for forwarding messages to Slack.\n\n' +
        'If you need to create a support ticket, please use the regular support channels.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 How to Forward Messages', 'forward_instructions')],
            [Markup.button.callback('« Back', 'main_menu')]
          ])
        },
        bot
      );
      return;
    }
    
    // update user last action timestamp
    updateUserState(userId, conversationStates.get(userId)?.state || MENU.MAIN);
    
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
        // set state to search and show search prompt
        updateUserState(userId, MENU.SEARCH);
        await ctx.deleteMessage();
        await MessageManager.sendMessage(
          ctx.chat.id,
          '🔍 *Search Knowledge Base*\n\n' +
          'Please enter your search query below. Type a few keywords related to your question.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('« Back to Knowledge Base', 'knowledge_base')]
            ])
          },
          bot
        );
        break;
        
      case 'new_ticket':
        // non-elevated users
        updateUserState(userId, MENU.AWAITING_TICKET_DESCRIPTION);
        await ctx.deleteMessage();
        await MessageManager.sendMessage(
          ctx.chat.id,
          '📝 *New Support Ticket*\n\n' +
          'Please describe your issue in detail. Include any relevant information such as:\n' +
          '• What you were trying to do\n' +
          '• What happened instead\n' +
          '• Any error messages\n' +
          "• Steps you've already taken\n\n" +
          'Your next message will be used to create the ticket.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔴 Cancel', 'cancel_ticket')]
            ])
          },
          bot
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
        
      case 'reopen_ticket':
        // non-elevated users only
        await handleReopenTicket(ctx, bot);
        break;
        
      case 'check_status':
        // Only for regular users
        await checkTicketStatus(ctx, bot);
        break;
        
      case 'add_info':
        // non-elevated users only
        updateUserState(userId, MENU.AWAITING_TICKET_UPDATE);
        await ctx.deleteMessage();
        await MessageManager.sendMessage(
          ctx.chat.id,
          '📝 *Add Information to Ticket*\n\n' +
          'Please type your additional information below. This will be added to your existing ticket.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔴 Cancel', 'cancel_update')]
            ])
          },
          bot
        );
        break;
        
      case 'cancel_update':
        conversationStates.delete(userId);
        await ctx.deleteMessage();
        await showSupportMenu(ctx, bot);
        break;
        
      // ticket callbacks
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

      case 'knowledge_base':
        await showKnowledgeBaseCategories(ctx, bot);
        break;

      case 'kb_categories':
        await showKnowledgeBaseCategories(ctx, bot);
        break;

      case 'kb_search':
        // Set state to search and show search prompt
        updateUserState(userId, MENU.SEARCH);
        await ctx.deleteMessage();
        await MessageManager.sendMessage(
          ctx.chat.id,
          '🔍 *Search Knowledge Base*\n\n' +
          'Please enter your search query below. Type a few keywords related to your question.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('« Back to Knowledge Base', 'kb_categories')]
            ])
          },
          bot
        );
        break;

      // Dynamic callback data handlers using regex
      default:
        // Category selection
        if (action.match(/^kb_category_(\d+)$/)) {
          const categoryId = action.match(/^kb_category_(\d+)$/)[1];
          await showCategorySections(ctx, bot, categoryId);
          break;
        }
        
        // Section selection
        if (action.match(/^kb_section_(\d+)$/)) {
          const sectionId = action.match(/^kb_section_(\d+)$/)[1];
          await showSectionArticles(ctx, bot, sectionId);
          break;
        }
        
        // Article selection
        if (action.match(/^kb_article_(\d+)$/)) {
          const articleId = action.match(/^kb_article_(\d+)$/)[1];
          await showArticleDetails(ctx, bot, articleId);
          break;
        }
        
        // Force display article in Telegram
        if (action.match(/^kb_force_article_(\d+)$/)) {
          const articleId = action.match(/^kb_force_article_(\d+)$/)[1];
          await showFullArticleInTelegram(ctx, bot, articleId);
          break;
        }

        // Pagination for articles
        if (action.match(/^kb_(prev|next)_articles_(\d+)$/)) {
          const matches = action.match(/^kb_(prev|next)_articles_(\d+)$/);
          const direction = matches[1];
          const page = parseInt(matches[2]);
          
          const userState = conversationStates.get(userId);
          if (userState && userState.sectionId) {
            await showSectionArticles(ctx, bot, userState.sectionId, userState.sortBy || 'position', page);
          } else {
            await showKnowledgeBaseCategories(ctx, bot);
          }
          break;
        }
        
        // Back to sections from article list
        if (action === 'kb_back_to_sections') {
          const userState = conversationStates.get(userId);
          if (userState && userState.categoryId) {
            await showCategorySections(ctx, bot, userState.categoryId);
          } else {
            await showKnowledgeBaseCategories(ctx, bot);
          }
          break;
        }
    }
  } catch (error) {
    logger.error('Error handling callback query:', error);
    await MessageManager.sendMessage(
      ctx.chat.id,
      '🔴 An error occurred processing your request. Please try again.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      },
      bot
    );
  }
}