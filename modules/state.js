// modules/state.js
/**
 * Shared state management
 */

// Storage for pending operations
export const pendingForwards = new Map();
export const pendingSlackAcknowledgments = new Map();

// Message IDs for cleanup
export const lastBotMessages = new Map();

// Conversation state tracking
export const conversationStates = new Map();

// Menu types for consistent reference
export const MENU = {
  MAIN: 'main_menu',
  SUPPORT: 'support_menu',
  FORWARD: 'forward_menu'
};