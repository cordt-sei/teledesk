// state.js

/**
 * Shared state management
 */

// Create shared Maps that will be imported by both the bot and webhook processes
export const pendingSlackAcks = new Map();
export const pendingForwards = new Map();
export const lastBotMessages = new Map();
export const conversationStates = new Map();

// Menu types for consistent reference
export const MENU = {
  MAIN: 'main_menu',
  SUPPORT: 'support_menu',
  FORWARD: 'forward_menu'
};