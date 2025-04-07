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
import {
  getHelpCenterCategories,
  getCategorySections,
  getSectionArticles,
  getArticleDetails,
  searchHelpCenter,
  formatArticleSummary,
  generateBrowsingKeyboard
} from './knowledgeBase.js';

// Initialize logger
const logger = createLogger('menus');

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
  
  try {
    // First attempt to fetch categories dynamically
    const categories = await getHelpCenterCategories();
    
    if (categories && categories.length > 0) {
      // We have categories, show dynamic menu
      const menuText = "📚 *SEI Knowledge Base*\n\n" +
        "Please select a category to explore, or search for specific topics:";
      
      // Create buttons for categories plus search option
      const buttons = [];
      
      // Add category buttons
      categories.forEach(category => {
        const articleCount = category.articleCount || 0;
        buttons.push([
          Markup.button.callback(
            `📚 ${category.name} (${articleCount} article${articleCount !== 1 ? 's' : ''})`, 
            `kb_category_${category.id}`
          )
        ]);
      });
      
      // Add search button
      buttons.push([Markup.button.callback('🔍 Search Knowledge Base', 'kb_search')]);
      
      // Add back button
      buttons.push([Markup.button.callback('« Back to Main Menu', 'main_menu')]);
      
      const menuMsg = await bot.telegram.sendMessage(ctx.chat.id, menuText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
      
      lastBotMessages.set(ctx.chat.id, [menuMsg.message_id]);
      conversationStates.set(userId, { 
        state: MENU.KNOWLEDGE_BASE,
        currentView: 'categories'
      });
    } else {
      // Fallback to static links if API fails or returns no categories
      const menuText = "📚 *SEI Knowledge Base*\n\n" +
        "Please select a topic to explore:";
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('🧑‍💼 I am a User', 'https://sei4039.zendesk.com/hc/en-us/categories/33633312151195-I-am-a-user')],
        [Markup.button.url('👨‍💻 I am a Developer', 'https://sei4039.zendesk.com/hc/en-us/categories/33633361397403-I-am-a-developer')],
        [Markup.button.url('🖥️ I am a Node Operator', 'https://sei4039.zendesk.com/hc/en-us/categories/33633332982171-I-am-a-validator')],
        [Markup.button.callback('🔍 Search Knowledge Base', 'kb_search')],
        [Markup.button.callback('« Back to Main Menu', 'main_menu')]
      ]);
      
      const menuMsg = await bot.telegram.sendMessage(ctx.chat.id, menuText, {
        parse_mode: 'Markdown',
        ...keyboard
      });
      
      lastBotMessages.set(ctx.chat.id, [menuMsg.message_id]);
      conversationStates.set(userId, { state: MENU.KNOWLEDGE_BASE });
    }
  } catch (error) {
    // If anything fails, fall back to static links
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

/**
 * Show knowledge base categories menu
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 */
export async function showKnowledgeBaseCategories(ctx, bot) {
  await cleanupPreviousMessages(ctx.chat.id, bot);
  
  const userId = ctx.from?.id || ctx.chat.id;
  
  try {
    // Show loading message
    const loadingMsg = await bot.telegram.sendMessage(
      ctx.chat.id,
      "📚 *Loading Knowledge Base Categories...*",
      { parse_mode: 'Markdown' }
    );
    
    // Get categories from the API
    const categories = await getHelpCenterCategories();
    
    if (!categories || categories.length === 0) {
      // No categories found
      await bot.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        "Sorry, no knowledge base categories found. Please try again later or contact support.",
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
            [Markup.button.callback('« Back to Main Menu', 'main_menu')]
          ])
        }
      );
      
      lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
      conversationStates.set(userId, { state: MENU.MAIN });
      return;
    }
    
    // Build categories menu
    const menuText = "📚 *SEI Knowledge Base*\n\n" +
      "Browse by category or search for specific topics:";
    
    // Generate keyboard with categories
    const keyboard = generateBrowsingKeyboard(categories, 'categories');
    
    // Update the loading message with categories
    await bot.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      menuText,
      {
        parse_mode: 'Markdown',
        ...keyboard
      }
    );
    
    lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
    conversationStates.set(userId, { 
      state: MENU.KNOWLEDGE_BASE,
      currentView: 'categories'
    });
  } catch (error) {
    logger.error('Error showing knowledge base categories:', error);
    
    await bot.telegram.sendMessage(
      ctx.chat.id,
      "📚 *Knowledge Base Error*\n\n" +
      "Sorry, there was an error loading the knowledge base. Please try again later or contact support directly.",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      }
    );
  }
}

/**
 * Show sections within a category
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 * @param {number} categoryId - Category ID
 */
export async function showCategorySections(ctx, bot, categoryId) {
  await cleanupPreviousMessages(ctx.chat.id, bot);
  
  const userId = ctx.from?.id || ctx.chat.id;
  
  try {
    // Show loading message
    const loadingMsg = await bot.telegram.sendMessage(
      ctx.chat.id,
      "📂 *Loading Sections...*",
      { parse_mode: 'Markdown' }
    );
    
    // Get category details and sections
    const sectionsPromise = getCategorySections(categoryId);
    const categoryPromise = axios.get(
      `${config.ZENDESK_API_URL}/help_center/categories/${categoryId}.json`,
      {
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    const [sections, categoryResponse] = await Promise.all([sectionsPromise, categoryPromise]);
    const category = categoryResponse.data.category;
    
    if (!sections || sections.length === 0) {
      // No sections found
      await bot.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        `*${category.name}*\n\nNo sections found in this category.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back to Categories', 'kb_categories')],
            [Markup.button.callback('« Back to Main Menu', 'main_menu')]
          ])
        }
      );
      
      lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
      conversationStates.set(userId, { 
        state: MENU.KNOWLEDGE_BASE,
        currentView: 'categories'
      });
      return;
    }
    
    // Build sections menu
    const menuText = `📚 *${category.name}*\n\n` +
      `${category.description || 'Select a section to browse articles:'}\n\n` +
      `${sections.length} section${sections.length !== 1 ? 's' : ''} available:`;
    
    // Generate keyboard with sections
    const keyboard = generateBrowsingKeyboard(sections, 'sections');
    
    // Update the loading message with sections
    await bot.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      menuText,
      {
        parse_mode: 'Markdown',
        ...keyboard
      }
    );
    
    lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
    conversationStates.set(userId, { 
      state: MENU.KNOWLEDGE_BASE,
      currentView: 'sections',
      categoryId: categoryId,
      categoryName: category.name
    });
  } catch (error) {
    logger.error(`Error showing sections for category ${categoryId}:`, error);
    
    await bot.telegram.sendMessage(
      ctx.chat.id,
      "📚 *Knowledge Base Error*\n\n" +
      "Sorry, there was an error loading the sections. Please try again later or contact support directly.",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back to Categories', 'kb_categories')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      }
    );
  }
}

/**
 * Show articles within a section
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 * @param {number} sectionId - Section ID
 * @param {string} sortBy - Sort field (created_at, updated_at, title, position)
 * @param {number} page - Page number
 */
export async function showSectionArticles(ctx, bot, sectionId, sortBy = 'position', page = 1) {
  await cleanupPreviousMessages(ctx.chat.id, bot);
  
  const userId = ctx.from?.id || ctx.chat.id;
  const articlesPerPage = 5; // Limit to 5 articles per page
  
  try {
    // Show loading message
    const loadingMsg = await bot.telegram.sendMessage(
      ctx.chat.id,
      "📄 *Loading Articles...*",
      { parse_mode: 'Markdown' }
    );
    
    // Get section details and articles
    const articlesPromise = getSectionArticles(sectionId, sortBy);
    const sectionPromise = axios.get(
      `${config.ZENDESK_API_URL}/help_center/sections/${sectionId}.json`,
      {
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    const [allArticles, sectionResponse] = await Promise.all([articlesPromise, sectionPromise]);
    const section = sectionResponse.data.section;
    
    if (!allArticles || allArticles.length === 0) {
      // No articles found
      await bot.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        `*${section.name}*\n\nNo articles found in this section.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back to Sections', `kb_category_${section.category_id}`)],
            [Markup.button.callback('« Back to Main Menu', 'main_menu')]
          ])
        }
      );
      
      lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
      return;
    }
    
    // Calculate pagination
    const totalPages = Math.ceil(allArticles.length / articlesPerPage);
    const startIndex = (page - 1) * articlesPerPage;
    const endIndex = Math.min(startIndex + articlesPerPage, allArticles.length);
    const articles = allArticles.slice(startIndex, endIndex);
    
    // Build articles menu
    const menuText = `📂 *${section.name}*\n\n` +
      `${section.description || 'Select an article to read:'}\n\n` +
      `Showing ${startIndex + 1}-${endIndex} of ${allArticles.length} article${allArticles.length !== 1 ? 's' : ''}:`;
    
    // Generate keyboard with articles and pagination
    const keyboard = generateBrowsingKeyboard(articles, 'articles', {
      page,
      totalPages
    });
    
    // Update the loading message with articles
    await bot.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      menuText,
      {
        parse_mode: 'Markdown',
        ...keyboard
      }
    );
    
    lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
    conversationStates.set(userId, { 
      state: MENU.KNOWLEDGE_BASE,
      currentView: 'articles',
      sectionId: sectionId,
      sectionName: section.name,
      categoryId: section.category_id,
      sortBy: sortBy,
      currentPage: page,
      totalPages: totalPages
    });
  } catch (error) {
    logger.error(`Error showing articles for section ${sectionId}:`, error);
    
    await bot.telegram.sendMessage(
      ctx.chat.id,
      "📚 *Knowledge Base Error*\n\n" +
      "Sorry, there was an error loading the articles. Please try again later or contact support directly.",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back to Categories', 'kb_categories')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      }
    );
  }
}

/**
 * Show article details with improved in-app content
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 * @param {number} articleId - Article ID
 */
export async function showArticleDetails(ctx, bot, articleId) {
  const userId = ctx.from?.id || ctx.chat.id;
  const userState = conversationStates.get(userId) || {};
  
  try {
    // Show loading message
    const loadingMsg = await bot.telegram.sendMessage(
      ctx.chat.id,
      "📝 *Loading Article...*",
      { parse_mode: 'Markdown' }
    );
    
    // Get article details
    const article = await getArticleDetails(articleId);
    
    if (!article) {
      // Article not found
      await bot.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        "Sorry, the article couldn't be found. It may have been moved or deleted.",
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back to Articles', `kb_section_${userState.sectionId || ''}`)],
            [Markup.button.callback('📚 KB Home', 'kb_categories')],
            [Markup.button.callback('« Back to Main Menu', 'main_menu')]
          ])
        }
      );
      
      lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
      return;
    }
    
    // Process HTML content for Telegram
    const processedBody = processHtmlForTelegram(article.body);
    
    // Determine if content is suitable for in-app display
    const maxInAppLength = 3800; // Telegram message limit with some buffer
    const isContentShort = processedBody.length <= maxInAppLength;
    const hasComplexFormatting = detectComplexFormatting(article.body);
    
    // If content is short and simple enough, show in Telegram
    if (isContentShort && !hasComplexFormatting) {
      // Build article message for in-app display
      const messageText = `📄 *${article.title}*\n\n` +
        `${processedBody}\n\n` +
        `🔄 Last updated: ${new Date(article.updated_at).toLocaleDateString()}`;

      // Update the loading message with article content
      await bot.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        messageText,
        {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          ...Markup.inlineKeyboard([
            [Markup.button.url('🔗 View on Website', article.html_url)],
            [Markup.button.callback('⬅️ Back to Articles', `kb_section_${article.section_id}`)],
            [Markup.button.callback('📚 KB Home', 'kb_categories')],
            [Markup.button.callback('« Back to Main Menu', 'main_menu')]
          ])
        }
      );
    } else {
      // Content is too complex or long, show preview with link
      // Extract a preview (first ~500 chars)
      const preview = processedBody.substring(0, 500) + (processedBody.length > 500 ? '...' : '');
      
      // Build preview message
      const previewText = `📄 *${article.title}*\n\n` +
        `${preview}\n\n` +
        `This article is ${hasComplexFormatting ? 'complex' : 'quite long'} and may display better on the website.\n` +
        `🔄 Last updated: ${new Date(article.updated_at).toLocaleDateString()}`;
        
      // Offer viewing options
      await bot.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        previewText,
        {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          ...Markup.inlineKeyboard([
            [Markup.button.url('🔗 View Full Article', article.html_url)],
            [hasComplexFormatting ? null : Markup.button.callback('📱 View in Telegram Anyway', `kb_force_article_${articleId}`)].filter(Boolean),
            [Markup.button.callback('⬅️ Back to Articles', `kb_section_${article.section_id}`)],
            [Markup.button.callback('📚 KB Home', 'kb_categories')],
            [Markup.button.callback('« Back to Main Menu', 'main_menu')]
          ])
        }
      );
    }
    
    lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
    conversationStates.set(userId, { 
      ...userState,
      currentView: 'article',
      articleId: articleId
    });
  } catch (error) {
    logger.error(`Error showing article ${articleId}:`, error);
    
    await bot.telegram.sendMessage(
      ctx.chat.id,
      "📚 *Knowledge Base Error*\n\n" +
      "Sorry, there was an error loading the article. Please try again later or contact support directly.",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back to Categories', 'kb_categories')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      }
    );
  }
}

/**
 * Force display of full article in Telegram even if it's long
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 * @param {number} articleId - Article ID
 */
export async function showFullArticleInTelegram(ctx, bot, articleId) {
  const userId = ctx.from?.id || ctx.chat.id;
  const userState = conversationStates.get(userId) || {};
  
  try {
    // Show loading message
    const loadingMsg = await bot.telegram.sendMessage(
      ctx.chat.id,
      "📝 *Loading Full Article...*",
      { parse_mode: 'Markdown' }
    );
    
    // Get article details
    const article = await getArticleDetails(articleId);
    
    if (!article) {
      // Article not found
      await bot.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        "Sorry, the article couldn't be found. It may have been moved or deleted.",
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back', `kb_section_${userState.sectionId || ''}`)],
            [Markup.button.callback('« Back to Main Menu', 'main_menu')]
          ])
        }
      );
      
      lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
      return;
    }
    
    // Process HTML content for Telegram
    const processedBody = processHtmlForTelegram(article.body);
    
    // Calculate if we need to split the content (Telegram has ~4000 char limit)
    const maxMessageLength = 3800;
    const needsSplitting = processedBody.length > maxMessageLength;
    
    if (needsSplitting) {
      // Split content into chunks
      const contentChunks = splitContentForTelegram(processedBody, maxMessageLength);
      
      // Send title in first message
      const firstMsg = await bot.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        `📄 *${article.title}* (Part 1/${contentChunks.length})\n\n${contentChunks[0]}`,
        {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        }
      );
      
      // Track messages for cleanup
      const messageIds = [firstMsg.message_id];
      
      // Send remaining chunks
      for (let i = 1; i < contentChunks.length; i++) {
        const msg = await bot.telegram.sendMessage(
          ctx.chat.id,
          `📄 *${article.title}* (Part ${i+1}/${contentChunks.length})\n\n${contentChunks[i]}`,
          {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          }
        );
        messageIds.push(msg.message_id);
      }
      
      // Send final message with navigation buttons
      const navMsg = await bot.telegram.sendMessage(
        ctx.chat.id,
        `🔄 Last updated: ${new Date(article.updated_at).toLocaleDateString()}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url('🔗 View on Website', article.html_url)],
            [Markup.button.callback('⬅️ Back to Articles', `kb_section_${article.section_id}`)],
            [Markup.button.callback('📚 KB Home', 'kb_categories')],
            [Markup.button.callback('« Back to Main Menu', 'main_menu')]
          ])
        }
      );
      
      messageIds.push(navMsg.message_id);
      lastBotMessages.set(ctx.chat.id, messageIds);
    } else {
      // Content fits in a single message
      const messageText = `📄 *${article.title}*\n\n` +
        `${processedBody}\n\n` +
        `🔄 Last updated: ${new Date(article.updated_at).toLocaleDateString()}`;

      await bot.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        messageText,
        {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          ...Markup.inlineKeyboard([
            [Markup.button.url('🔗 View on Website', article.html_url)],
            [Markup.button.callback('⬅️ Back to Articles', `kb_section_${article.section_id}`)],
            [Markup.button.callback('📚 KB Home', 'kb_categories')],
            [Markup.button.callback('« Back to Main Menu', 'main_menu')]
          ])
        }
      );
      
      lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
    }
    
    conversationStates.set(userId, { 
      ...userState,
      currentView: 'full_article',
      articleId: articleId
    });
  } catch (error) {
    logger.error(`Error showing full article ${articleId}:`, error);
    
    await bot.telegram.sendMessage(
      ctx.chat.id,
      "📚 *Knowledge Base Error*\n\n" +
      "Sorry, there was an error displaying the full article. Please try viewing it on the website instead.",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('🔗 View on Website', article?.html_url || `${config.ZENDESK_API_URL.replace('/api/v2', '')}/hc/articles/${articleId}`)],
          [Markup.button.callback('⬅️ Back to Categories', 'kb_categories')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      }
    );
  }
}

/**
 * Process HTML content for Telegram Markdown
 * @param {string} html - HTML content
 * @returns {string} Processed content for Telegram
 */
function processHtmlForTelegram(html) {
  if (!html) return '';
  
  return html
    // Headers
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '*$1*\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '*$1*\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '*$1*\n\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '*$1*\n\n')
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '*$1*\n\n')
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '*$1*\n\n')
    
    // Paragraphs and breaks
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    
    // Lists
    .replace(/<ul[^>]*>(.*?)<\/ul>/gis, '$1\n')
    .replace(/<ol[^>]*>(.*?)<\/ol>/gis, '$1\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n')
    
    // Formatting
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '*$1*')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '*$1*')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '_$1_')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '_$1_')
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>(.*?)<\/pre>/gi, '```\n$1\n```')
    
    // Links - simplified to prevent parse mode issues
    .replace(/<a[^>]*href=["'](.*?)["'][^>]*>(.*?)<\/a>/gi, '$2 [$1]')
    
    // Strip remaining HTML tags
    .replace(/<[^>]*>/g, '')
    
    // Fix common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    
    // Fix whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * Detect if article has complex formatting that might not render well in Telegram
 * @param {string} html - HTML content
 * @returns {boolean} True if complex formatting detected
 */
function detectComplexFormatting(html) {
  if (!html) return false;
  
  // Check for tables
  if (/<table|<th|<td|<tr/i.test(html)) return true;
  
  // Check for images (might be important to the content)
  if (/<img/i.test(html)) return true;
  
  // Check for complex divs with classes (likely custom formatting)
  if (/<div class="(?!(?:simple|text))[^"]+"/i.test(html)) return true;
  
  // Check for iframes (embedded content)
  if (/<iframe/i.test(html)) return true;
  
  // Check for SVGs or canvas
  if (/<svg|<canvas/i.test(html)) return true;
  
  return false;
}

/**
 * Split content into chunks for Telegram messages
 * @param {string} content - Content to split
 * @param {number} maxLength - Maximum chunk length
 * @returns {Array} Array of content chunks
 */
function splitContentForTelegram(content, maxLength) {
  const chunks = [];
  
  // Try to split on paragraphs first
  const paragraphs = content.split('\n\n');
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed max length, push current chunk and start new one
    if (currentChunk.length + paragraph.length + 2 > maxLength) {
      // If current chunk is already at limit, push it
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      
      // If paragraph itself is too long, split it further
      if (paragraph.length > maxLength) {
        const sentencesChunks = splitLargeText(paragraph, maxLength);
        chunks.push(...sentencesChunks.slice(0, -1));
        currentChunk = sentencesChunks[sentencesChunks.length - 1];
      } else {
        currentChunk = paragraph;
      }
    } else {
      // Add paragraph to current chunk
      if (currentChunk.length > 0) {
        currentChunk += '\n\n';
      }
      currentChunk += paragraph;
    }
  }
  
  // Push any remaining content
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

/**
 * Split very large text blocks when necessary
 * @param {string} text - Text to split
 * @param {number} maxLength - Maximum length per chunk
 * @returns {Array} Array of text chunks
 */
function splitLargeText(text, maxLength) {
  const chunks = [];
  
  // Try to split on sentences
  const sentences = text.split(/(?<=[.!?])\s+/);
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length + 1 > maxLength) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      
      // If sentence itself is too long, split by length
      if (sentence.length > maxLength) {
        let remainingSentence = sentence;
        while (remainingSentence.length > 0) {
          const chunk = remainingSentence.substring(0, maxLength);
          chunks.push(chunk);
          remainingSentence = remainingSentence.substring(maxLength);
        }
      } else {
        currentChunk = sentence;
      }
    } else {
      if (currentChunk.length > 0) {
        currentChunk += ' ';
      }
      currentChunk += sentence;
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

/**
 * Process knowledge base search
 * @param {Object} ctx - Telegram context
 * @param {Object} bot - Telegram bot instance
 * @param {string} query - Search query
 */
export async function searchKnowledgeBase(ctx, bot, query) {
  if (!query || query.trim().length < 3) {
    await ctx.reply("Please provide a search term of at least 3 characters.");
    return;
  }
  
  const userId = ctx.from?.id || ctx.chat.id;
  
  try {
    // Show loading message
    const loadingMsg = await bot.telegram.sendMessage(
      ctx.chat.id,
      `🔍 *Searching for: "${query}"*`,
      { parse_mode: 'Markdown' }
    );
    
    // Perform search
    const results = await searchHelpCenter(query);
    
    if (!results || results.length === 0) {
      // No results found
      await bot.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        `🔍 *No results found for "${query}"*\n\n` +
        "Try different keywords or create a support ticket if you need assistance.",
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📚 KB Home', 'kb_categories')],
            [Markup.button.callback('📝 Create Support Ticket', 'new_ticket')],
            [Markup.button.callback('« Back to Main Menu', 'main_menu')]
          ])
        }
      );
      
      lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
      return;
    }
    
    // Limit to top 5 results
    const topResults = results.slice(0, 5);
    
    // Build search results message
    let resultsMessage = `🔍 *Search Results for "${query}"*\n\n`;
    
    for (const [index, article] of topResults.entries()) {
      resultsMessage += `${index + 1}. [${article.title}](${article.html_url})\n`;
      
      // Add snippet if available
      if (article.snippet) {
        // Clean snippet
        const cleanSnippet = article.snippet
          .replace(/<em>/g, '_')
          .replace(/<\/em>/g, '_')
          .replace(/<[^>]*>?/gm, '');
          
        resultsMessage += `   ${cleanSnippet}\n\n`;
      } else {
        resultsMessage += '\n';
      }
    }
    
    if (results.length > 5) {
      resultsMessage += `_Showing top 5 of ${results.length} results_\n\n`;
    }
    
    // Build keyboard with article buttons
    const keyboard = [];
    
    topResults.forEach((article, index) => {
      keyboard.push([
        Markup.button.callback(`📄 ${index + 1}. ${article.title.substring(0, 25)}${article.title.length > 25 ? '...' : ''}`, `kb_article_${article.id}`)
      ]);
    });
    
    // Add navigation buttons
    keyboard.push([
      Markup.button.callback('🔍 New Search', 'kb_search'),
      Markup.button.callback('📚 KB Home', 'kb_categories')
    ]);
    
    keyboard.push([
      Markup.button.callback('« Back to Main Menu', 'main_menu')
    ]);
    
    // Update the loading message with search results
    await bot.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      resultsMessage,
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard(keyboard)
      }
    );
    
    lastBotMessages.set(ctx.chat.id, [loadingMsg.message_id]);
    conversationStates.set(userId, { 
      state: MENU.KNOWLEDGE_BASE,
      currentView: 'search_results',
      searchQuery: query
    });
  } catch (error) {
    logger.error(`Error searching knowledge base for "${query}":`, error);
    
    await bot.telegram.sendMessage(
      ctx.chat.id,
      "🔍 *Search Error*\n\n" +
      "Sorry, there was an error processing your search. Please try again later or contact support directly.",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📚 KB Home', 'kb_categories')],
          [Markup.button.callback('« Back to Main Menu', 'main_menu')]
        ])
      }
    );
  }
}