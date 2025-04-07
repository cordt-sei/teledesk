// modules/menus.js
import { Markup } from 'telegraf';
import config from '../config.js';
import { getActiveTicket } from './zendeskIntegration.js';
import { 
  lastBotMessages, 
  conversationStates, 
  MENU 
} from './state.js';
import axios from 'axios';
import createLogger from './logger.js';

// Initialize logger
const logger = createLogger('menus');

/**
 * Clean up previous bot messages
 * @param {number} chatId - Telegram chat ID
 * @param {Object} bot - Telegram bot instance
 */
export async function cleanupPreviousMessages(chatId, bot) {
  const previousMessages = lastBotMessages.get(chatId);
  
  if (previousMessages && previousMessages.length > 0) {
    // Delete previous menus/prompts to avoid cluttering the chat
    for (const msgId of previousMessages) {
      try {
        await bot.telegram.deleteMessage(chatId, msgId);
      } catch (error) {
        // Ignore errors for message deletion (might be too old)
        logger.debug(`Could not delete message ${msgId}: ${error.message}`);
      }
    }
  }
  
  lastBotMessages.delete(chatId);
}

/**
 * Show main menu
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 */
export async function showMainMenu(ctx, bot) {
  await cleanupPreviousMessages(ctx.chat.id, bot);
  
  const userId = ctx.from?.id || ctx.chat.id;
  const isTeamMember = config.TEAM_MEMBERS.has(userId);
  
  let menuText, keyboard;
  
  if (isTeamMember) {
    // Team member menu
    menuText = "🔷 *SEI Team Menu*\n\n" +
      "As a team member, you can forward messages from other users/groups to Slack.";
    
    keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 How to Forward Messages', 'forward_instructions')],
      [Markup.button.callback('❓ Help / Commands', 'help')]
    ]);
  } else {
    // Regular user menu
    menuText = "🔷 *SEI Support Main Menu*\n\n" +
      "How can we help you today?";
    
    keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📚 Knowledge Base', 'knowledge_base')],
      [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
      [Markup.button.callback('🔍 View Active Ticket', 'view_ticket')],
      [Markup.button.callback('❓ Help / Commands', 'help')]
    ]);
  }
  
  const menuMsg = await bot.telegram.sendMessage(ctx.chat.id, menuText, {
    parse_mode: 'Markdown',
    ...keyboard
  });
  
  lastBotMessages.set(ctx.chat.id, [menuMsg.message_id]);
  conversationStates.set(userId, { state: isTeamMember ? MENU.FORWARD : MENU.MAIN });
}

/**
 * Show knowledge base menu
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 */
export async function showKnowledgeBaseMenu(ctx, bot) {
  await cleanupPreviousMessages(ctx.chat.id, bot);
  
  const userId = ctx.from?.id || ctx.chat.id;
  
  const menuText = "📚 *SEI Knowledge Base*\n\n" +
    "Please select a topic to explore:";
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('🧑‍💼 I am a User', 'https://sei4039.zendesk.com/hc/en-us/categories/33633312151195-I-am-a-user')],
    [Markup.button.url('👨‍💻 I am a Developer', 'https://sei4039.zendesk.com/hc/en-us/categories/33633361397403-I-am-a-developer')],
    [Markup.button.url('🖥️ I am a Node Operator', 'https://sei4039.zendesk.com/hc/en-us/categories/33633332982171-I-am-a-validator')],
    [Markup.button.callback('« Back to Main Menu', 'main_menu')]
  ]);
  
  const menuMsg = await bot.telegram.sendMessage(ctx.chat.id, menuText, {
    parse_mode: 'Markdown',
    ...keyboard
  });
  
  lastBotMessages.set(ctx.chat.id, [menuMsg.message_id]);
  conversationStates.set(userId, { state: MENU.KNOWLEDGE_BASE });
}

/**
 * Search Zendesk Knowledge Base
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 * @param {string} query - Search query
 */
export async function searchKnowledgeBase(ctx, bot, query) {
  try {
    // Ensure valid query
    if (!query || query.trim().length < 3) {
      await ctx.reply("Please provide a search term of at least 3 characters.");
      return;
    }
    
    const searchUrl = `${config.ZENDESK_API_URL}/help_center/articles/search.json?query=${encodeURIComponent(query)}`;
    
    const response = await axios.get(searchUrl, {
      auth: {
        username: `${config.ZENDESK_EMAIL}/token`,
        password: config.ZENDESK_API_TOKEN
      }
    });
    
    const results = response.data.results;
    
    if (!results || results.length === 0) {
      await ctx.reply(
        "No articles found matching your search. Please try different keywords or create a support ticket.",
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
          [Markup.button.callback('« Back to Knowledge Base', 'knowledge_base')]
        ])
      );
      return;
    }
    
    // Show top 5 results
    const topResults = results.slice(0, 5);
    let resultsMessage = "🔍 *Search Results*\n\n";
    
    for (const [index, article] of topResults.entries()) {
      resultsMessage += `${index + 1}. [${article.title}](${article.html_url})\n`;
    }
    
    resultsMessage += "\nIf these articles don't solve your issue, you can create a support ticket.";
    
    await ctx.reply(resultsMessage, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
        [Markup.button.callback('« Back to Knowledge Base', 'knowledge_base')]
      ])
    });
    
  } catch (error) {
    logger.error('Error searching knowledge base:', error);
    await ctx.reply(
      "Sorry, there was an error searching the knowledge base. Please try again later or create a support ticket.",
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
        [Markup.button.callback('« Back to Main Menu', 'main_menu')]
      ])
    );
  }
}

/**
 * Show support menu
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 */
export async function showSupportMenu(ctx, bot) {
  await cleanupPreviousMessages(ctx.chat.id, bot);
  
  const userId = ctx.from?.id || ctx.chat.id;
  const hasTicket = await getActiveTicket(userId);
  
  const menuText = hasTicket ? 
    "🎫 *Support Ticket Options*\n\n" +
    "You have an active support ticket. What would you like to do?" : 
    "🎫 *Support Ticket Options*\n\n" +
    "You don't have an active ticket. Would you like to create one?";
  
  const keyboard = hasTicket ? 
    Markup.inlineKeyboard([
      [Markup.button.callback('📝 Add Information', 'add_info')],
      [Markup.button.callback('🔍 Check Status', 'check_status')],
      [Markup.button.callback('🟢 Close Ticket', 'close_ticket')],
      [Markup.button.callback('« Back to Main Menu', 'main_menu')]
    ]) : 
    Markup.inlineKeyboard([
      [Markup.button.callback('📝 Create New Ticket', 'new_ticket')],
      [Markup.button.callback('« Back to Main Menu', 'main_menu')]
    ]);
  
  const menuMsg = await bot.telegram.sendMessage(ctx.chat.id, menuText, {
    parse_mode: 'Markdown',
    ...keyboard
  });
  
  lastBotMessages.set(ctx.chat.id, [menuMsg.message_id]);
  conversationStates.set(userId, { state: MENU.SUPPORT });
}

/**
 * Show forwarding instructions
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 */
export async function showForwardInstructions(ctx, bot) {
  await cleanupPreviousMessages(ctx.chat.id, bot);
  
  const userId = ctx.from?.id || ctx.chat.id;
  const isTeamMember = config.TEAM_MEMBERS.has(userId);
  
  // Only show to team members
  if (!isTeamMember) {
    const errorMsg = await bot.telegram.sendMessage(
      ctx.chat.id,
      "This feature is only available to team members.",
      mainMenuKeyboard
    );
    
    lastBotMessages.set(ctx.chat.id, [errorMsg.message_id]);
    conversationStates.set(userId, { state: MENU.MAIN });
    return;
  }
  
  const instructionsMsg = await bot.telegram.sendMessage(
    ctx.chat.id,
    "🔄 *Forwarding Messages to Slack*\n\n" +
    "To forward a message:\n\n" +
    "1. In any chat, long-press on the message you want to forward\n" +
    "2. Tap 'Forward'\n" +
    "3. Select this bot as the destination\n" +
    "4. The message will be sent to the team Slack channel\n\n" +
    "If the source isn't detected automatically, you'll be asked to provide it.",
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('« Back', 'main_menu')]
      ])
    }
  );
  
  lastBotMessages.set(ctx.chat.id, [instructionsMsg.message_id]);
  conversationStates.set(userId, { state: MENU.FORWARD });
}

/**
 * Show search prompt
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 */
export async function showSearchPrompt(ctx, bot) {
  await cleanupPreviousMessages(ctx.chat.id, bot);
  
  const userId = ctx.from?.id || ctx.chat.id;
  
  const promptMsg = await bot.telegram.sendMessage(
    ctx.chat.id,
    "🔍 *Search Knowledge Base*\n\n" +
    "Please enter your search query below.",
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('« Back to Knowledge Base', 'knowledge_base')]
      ])
    }
  );
  
  lastBotMessages.set(ctx.chat.id, [promptMsg.message_id]);
  conversationStates.set(userId, { state: MENU.SEARCH });
}

// Export predefined keyboards
export const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📚 Knowledge Base', 'knowledge_base')],
  [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
  [Markup.button.callback('🔍 View Active Ticket', 'view_ticket')],
  [Markup.button.callback('❓ Help / Commands', 'help')]
]);

export const supportMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('📝 Add Information', 'add_info')],
  [Markup.button.callback('🔍 Check Status', 'check_status')],
  [Markup.button.callback('🟢 Close Ticket', 'close_ticket')],
  [Markup.button.callback('« Back to Main Menu', 'main_menu')]
]);

export const knowledgeBaseKeyboard = Markup.inlineKeyboard([
  [Markup.button.url('🧑‍💼 I am a User', 'https://sei4039.zendesk.com/hc/en-us/categories/33633312151195-I-am-a-user')],
  [Markup.button.url('👨‍💻 I am a Developer', 'https://sei4039.zendesk.com/hc/en-us/categories/33633361397403-I-am-a-developer')],
  [Markup.button.url('🖥️ I am a Node Operator', 'https://sei4039.zendesk.com/hc/en-us/categories/33633332982171-I-am-a-validator')],
  [Markup.button.callback('« Back to Main Menu', 'main_menu')]
]);

export const backToMainKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('« Back to Main Menu', 'main_menu')]
]);