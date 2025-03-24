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

// auto-save interval for messages awaiting ack (10 seconds)
const AUTO_SAVE_INTERVAL = 10000;

// shared maps for bot + webhook
export const pendingSlackAcks = new Map();
export const pendingForwards = new Map();
export const lastBotMessages = new Map();
export const conversationStates = new Map();

// menu types
export const MENU = {
  MAIN: 'main_menu',
  SUPPORT: 'support_menu',
  FORWARD: 'forward_menu'
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
        
        // Filter out entries without required fields
        let validCount = 0;
        let invalidCount = 0;
        
        for (const [key, value] of Object.entries(acks)) {
          if (value && value.telegramChatId) {
            pendingSlackAcks.set(key, value);
            validCount++;
          } else {
            invalidCount++;
          }
        }
        
        if (invalidCount > 0) {
          logger.warn(`Filtered out ${invalidCount} invalid entries from pendingAcks.json`);
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

// Initialize state
export function initializeState() {
  // Ensure data directory exists first
  fs.mkdir(stateDir, { recursive: true })
    .then(() => {
      logger.info('Data directory ensured');
      return loadPendingAcksFromDisk();
    })
    .catch(err => {
      logger.error('Error initializing state directory:', err);
    });
  
  // Set up auto-save interval with improved error handling
  setInterval(() => {
    savePendingAcksToDisk()
      .catch(err => logger.error('Auto-save error:', err));
  }, AUTO_SAVE_INTERVAL);
  
  // Extra: Check file permissions
  fs.chmod(stateDir, 0o755).catch(() => {});
}

// Save state on exit
export function setupShutdownHandlers() {
  process.on('SIGINT', async () => {
    logger.info('Process terminating, saving state...');
    await savePendingAcksToDisk();
  });
  
  process.on('SIGTERM', async () => {
    logger.info('Process terminating, saving state...');
    await savePendingAcksToDisk();
  });
}