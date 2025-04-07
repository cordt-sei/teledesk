// state.js
/**
 * Shared state management
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import createLogger from './logger.js';

// Initialize logger
const logger = createLogger('state');

// Get the current directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stateDir = path.join(__dirname, '..', 'data');
const pendingAcksFile = path.join(stateDir, 'pendingAcks.json');
const conversationStatesFile = path.join(stateDir, 'conversationStates.json');

// auto-save interval for messages awaiting ack (10 seconds)
const AUTO_SAVE_INTERVAL = 10000;

// expiry timer for user state (48h in ms)
const STATE_EXPIRY_DURATION = 48 * 60 * 60 * 1000;

// max age for state data retention (14d in ms)
const MAX_DATA_AGE = 14 * 24 * 60 * 60 * 1000;

// shared maps for bot + webhook
export const pendingSlackAcks = new Map();
export const pendingForwards = new Map();
export const lastBotMessages = new Map();
export const conversationStates = new Map();

// menu types
export const MENU = {
  MAIN: 'main_menu',
  SUPPORT: 'support_menu',
  FORWARD: 'forward_menu',
  KNOWLEDGE_BASE: 'knowledge_base',
  SEARCH: 'search_menu',
  AWAITING_TICKET_DESCRIPTION: 'awaiting_ticket_description',
  AWAITING_TICKET_UPDATE: 'awaiting_ticket_update',
  AWAITING_TICKET_CHOICE: 'awaiting_ticket_choice',
  AWAITING_FORWARD_SOURCE: 'awaiting_forward_source'
};

// load pending acks
export async function loadPendingAcksFromDisk() {
  try {
    // Ensure data directory exists
    await fs.mkdir(stateDir, { recursive: true });
    logger.info('Data directory ensured');
    
    try {
      // Check if file exists
      try {
        await fs.access(pendingAcksFile);
        logger.info('Found pendingAcks state file');
      } catch (err) {
        // File doesn't exist, create a new empty one
        await fs.writeFile(pendingAcksFile, '{}', { mode: 0o644 });
        logger.info('Created new pendingAcks state file');
        return;
      }
      
      // Read the file
      const data = await fs.readFile(pendingAcksFile, 'utf8');
      
      if (!data || data.trim() === '') {
        logger.warn('Empty pendingAcks file found, initializing with empty object');
        await fs.writeFile(pendingAcksFile, '{}', { mode: 0o644 });
        return;
      }
      
      try {
        const acks = JSON.parse(data);
        
        // Clear and fill map
        pendingSlackAcks.clear();
        
        // filter expired entries or without required fields
        let validCount = 0;
        let invalidCount = 0;
        let expiredCount = 0;
        const now = Date.now();
        
        for (const [key, value] of Object.entries(acks)) {
          // confirm entry is complete
          if (value && value.telegramChatId) {
            // check expiry (older than MAX_DATA_AGE)
            if (value.timestamp && (now - value.timestamp > MAX_DATA_AGE)) {
              expiredCount++;
              continue;
            }
            
            pendingSlackAcks.set(key, value);
            validCount++;
          } else {
            invalidCount++;
          }
        }
        
        if (invalidCount > 0) {
          logger.warn(`Filtered out ${invalidCount} invalid entries from pendingAcks.json`);
        }
        
        if (expiredCount > 0) {
          logger.info(`Removed ${expiredCount} expired entries from pendingAcks.json`);
        }
        
        logger.info(`Loaded ${validCount} pending acks from disk`, {
          keys: Array.from(pendingSlackAcks.keys())
        });
      } catch (parseError) {
        logger.error('Error parsing pendingAcks JSON, resetting file:', parseError);
        await fs.writeFile(pendingAcksFile, '{}', { mode: 0o644 });
      }
    } catch (error) {
      logger.error('Error loading pending acks from disk:', error);
      try {
        await fs.writeFile(pendingAcksFile, '{}', { mode: 0o644 });
      } catch (writeError) {
        logger.error('Failed to create empty pendingAcks file:', writeError);
      }
    }
  } catch (error) {
    logger.error('Unexpected error in loadPendingAcksFromDisk:', error);
  }
}

// load conversation states
export async function loadConversationStatesFromDisk() {
  try {
    // Ensure data directory exists
    await fs.mkdir(stateDir, { recursive: true });
    
    try {
      // ensure file exists
      try {
        await fs.access(conversationStatesFile);
        logger.info('Found conversationStates state file');
      } catch (err) {
        await fs.writeFile(conversationStatesFile, '{}', { mode: 0o644 });
        logger.info('Created new conversationStates state file');
        return;
      }
      
      const data = await fs.readFile(conversationStatesFile, 'utf8');
      
      if (!data || data.trim() === '') {
        logger.warn('Empty conversationStates file found, initializing with empty object');
        await fs.writeFile(conversationStatesFile, '{}', { mode: 0o644 });
        return;
      }
      
      try {
        const states = JSON.parse(data);
        
        // clear and fill map
        conversationStates.clear();
        
        // filter expired entries
        let validCount = 0;
        let expiredCount = 0;
        const now = Date.now();
        
        for (const [userId, state] of Object.entries(states)) {
          // check if state has a last activity timestamp earlier than expiry
          if (state && state.lastActivity && (now - state.lastActivity <= STATE_EXPIRY_DURATION)) {
            // check if data expired (older than MAX_DATA_AGE)
            if (now - state.lastActivity > MAX_DATA_AGE) {
              expiredCount++;
              continue;
            }
            
            conversationStates.set(parseInt(userId), state);
            validCount++;
          } else {
            expiredCount++;
          }
        }
        
        if (expiredCount > 0) {
          logger.info(`Filtered out ${expiredCount} expired conversation states`);
        }
        
        logger.info(`Loaded ${validCount} conversation states from disk`);
      } catch (parseError) {
        logger.error('Error parsing conversationStates JSON, resetting file:', parseError);
        await fs.writeFile(conversationStatesFile, '{}', { mode: 0o644 });
      }
    } catch (error) {
      logger.error('Error loading conversation states from disk:', error);
      try {
        await fs.writeFile(conversationStatesFile, '{}', { mode: 0o644 });
      } catch (writeError) {
        logger.error('Failed to create empty conversationStates file:', writeError);
      }
    }
  } catch (error) {
    logger.error('Unexpected error in loadConversationStatesFromDisk:', error);
  }
}

// save pending acks with improved error handling and verification
export async function savePendingAcksToDisk() {
  try {
    // Convert map to object
    const acks = {};
    for (const [key, value] of pendingSlackAcks.entries()) {
      acks[key] = value;
    }
    
    // Write directly without verification step
    await fs.writeFile(pendingAcksFile, JSON.stringify(acks, null, 2), { 
      mode: 0o644,
      flag: 'w'
    });
    
    logger.debug(`Saved ${pendingSlackAcks.size} pending acks to disk`);
  } catch (error) {
    logger.error('Error saving pending acks to disk:', error);
  }
}

// save conversation states
export async function saveConversationStatesToDisk() {
  try {
    // First update all states with lastActivity timestamp if not present
    const now = Date.now();
    const states = {};
    
    for (const [userId, state] of conversationStates.entries()) {
      // Ensure state has lastActivity timestamp
      if (!state.lastActivity) {
        state.lastActivity = now;
      }
      
      // convert Map key to string for JSON
      states[userId.toString()] = state;
    }
    
    // write to disk
    await fs.writeFile(conversationStatesFile, JSON.stringify(states, null, 2), {
      mode: 0o644,
      flag: 'w'
    });
    
    logger.debug(`Saved ${conversationStates.size} conversation states to disk`);
  } catch (error) {
    logger.error('Error saving conversation states to disk:', error);
  }
}

/**
 * Update user state with current activity timestamp
 * @param {number} userId - User ID 
 * @param {string} state - State name
 * @param {Object} additionalData - Any additional state data
 */
export function updateUserState(userId, stateName, additionalData = {}) {
  const existingState = conversationStates.get(userId) || {};
  const newState = {
    ...existingState,
    ...additionalData,
    state: stateName,
    lastActivity: Date.now()
  };
  
  conversationStates.set(userId, newState);
}

/**
 * Check if user state has expired
 * @param {number} userId - User ID 
 * @returns {boolean} True if expired or no state exists
 */
export function hasStateExpired(userId) {
  const state = conversationStates.get(userId);
  
  if (!state || !state.lastActivity) {
    return true;
  }
  
  const now = Date.now();
  return (now - state.lastActivity) > STATE_EXPIRY_DURATION;
}

/**
 * Cleanup expired states and old data
 */
export function cleanupExpiredStates() {
  const now = Date.now();
  let expiredCount = 0;
  let oldDataCount = 0;
  
  // Cleanup conversation states
  for (const [userId, state] of conversationStates.entries()) {
    if (!state.lastActivity || (now - state.lastActivity > STATE_EXPIRY_DURATION)) {
      conversationStates.delete(userId);
      expiredCount++;
    } else if (now - state.lastActivity > MAX_DATA_AGE) {
      conversationStates.delete(userId);
      oldDataCount++;
    }
  }
  
  // clear pending slack acks
  for (const [key, value] of pendingSlackAcks.entries()) {
    if (value.timestamp && (now - value.timestamp > MAX_DATA_AGE)) {
      pendingSlackAcks.delete(key);
      oldDataCount++;
    }
  }
  
  // log cleanup
  if (expiredCount > 0 || oldDataCount > 0) {
    logger.info(`Cleanup: removed ${expiredCount} expired states and ${oldDataCount} old data entries`);
    
    // save cleaned state
    savePendingAcksToDisk();
    saveConversationStatesToDisk();
  }
}

// init state
export function initializeState() {
  // Ensure data directory exists first
  fs.mkdir(stateDir, { recursive: true })
    .then(() => {
      logger.info('Data directory ensured');
      
      // load existing state
      return Promise.all([
        loadPendingAcksFromDisk(),
        loadConversationStatesFromDisk()
      ]);
    })
    .then(() => {
      logger.info('State initialization complete');
    })
    .catch(err => {
      logger.error('Error initializing state directory:', err);
    });
  
  // Set up auto-save interval with improved error handling
  setInterval(() => {
    savePendingAcksToDisk()
      .catch(err => logger.error('Auto-save error for pending acks:', err));
    
    saveConversationStatesToDisk()
      .catch(err => logger.error('Auto-save error for conversation states:', err));
  }, AUTO_SAVE_INTERVAL);
  
  // periodic state cleanup (run every hour)
  setInterval(() => {
    cleanupExpiredStates();
  }, 60 * 60 * 1000);
  
  // check file permissions
  fs.chmod(stateDir, 0o755).catch(() => {});
}

// save state on exit
export function setupShutdownHandlers() {
  process.on('SIGINT', async () => {
    logger.info('Process terminating, saving state...');
    await Promise.all([
      savePendingAcksToDisk(),
      saveConversationStatesToDisk()
    ]);
  });
  
  process.on('SIGTERM', async () => {
    logger.info('Process terminating, saving state...');
    await Promise.all([
      savePendingAcksToDisk(),
      saveConversationStatesToDisk()
    ]);
  });
}