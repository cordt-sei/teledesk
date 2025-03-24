// modules/menus.js
import { Markup } from 'telegraf';
import config from '../config.js';
import { getActiveTicket } from './zendeskIntegration.js';
import { 
  lastBotMessages, 
  conversationStates, 
  MENU 
} from './state.js';

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
        console.log(`Could not delete message ${msgId}: ${error.message}`);
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
    menuText = " *SEI Team Menu*\n\n" +
      "As a team member, you can forward messages from other users/groups to Slack.";
    
    keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 How to Forward Messages', 'forward_instructions')],
      [Markup.button.callback('❓ Help / Commands', 'help')]
    ]);
  } else {
    // Regular user menu
    menuText = " *SEI Support Main Menu*\n\n" +
      "What would you like to do?";
    
    keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(' Support Ticket', 'new_ticket')],
      [Markup.button.callback(' View Active Ticket', 'view_ticket')],
      [Markup.button.callback('❓ Help / Commands', 'help')]
    ]);
  }
  
  const menuMsg = await bot.telegram.sendMessage(ctx.chat.id, menuText, keyboard);
  
  lastBotMessages.set(ctx.chat.id, [menuMsg.message_id]);
  conversationStates.set(userId, { state: isTeamMember ? MENU.FORWARD : MENU.MAIN });
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
  
  const menuMsg = await bot.telegram.sendMessage(
    ctx.chat.id,
    " *Support Ticket Options*\n\n" +
    (hasTicket ? 
      "You have an active support ticket. What would you like to do?" : 
      "You don't have an active ticket. Would you like to create one?"),
    hasTicket ? 
      supportMenuKeyboard : 
      Markup.inlineKeyboard([
        [Markup.button.callback(' Create New Ticket', 'new_ticket')],
        [Markup.button.callback('« Back to Main Menu', 'main_menu')]
      ])
  );
  
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
    Markup.inlineKeyboard([
      [Markup.button.callback('« Back', 'main_menu')]
    ])
  );
  
  lastBotMessages.set(ctx.chat.id, [instructionsMsg.message_id]);
  conversationStates.set(userId, { state: MENU.FORWARD });
}

// Export predefined keyboards
export const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback(' Support Ticket', 'new_ticket')],
  [Markup.button.callback(' View Active Ticket', 'view_ticket')],
  [Markup.button.callback('❓ Help / Commands', 'help')]
]);

export const supportMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback(' Add Information', 'add_info')],
  [Markup.button.callback(' Check Status', 'check_status')],
  [Markup.button.callback('🟢 Close Ticket', 'close_ticket')],
  [Markup.button.callback('« Back to Main Menu', 'main_menu')]
]);

export const backToMainKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('« Back to Main Menu', 'main_menu')]
]);