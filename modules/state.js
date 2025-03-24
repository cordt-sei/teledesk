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

// auto-save interval for messages awaiting ack
const AUTO_SAVE_INTERVAL = 10000; // 10 seconds

// shared maps for bot + webhook
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

// Load pending acks from disk
export async function loadPendingAcksFromDisk() {
  try {
    // Create state directory if it doesn't exist
    await fs.mkdir(stateDir, { recursive: true }).catch(() => {});
    
    // Check if file exists before loading
    try {
      await fs.access(pendingAcksFile);
    } catch (err) {
      // File doesn't exist, create it with empty object
      await fs.writeFile(pendingAcksFile, '{}');
      logger.info('Created new pendingAcks state file');
      return;
    }
    
    // Load the file
    const data = await fs.readFile(pendingAcksFile, 'utf8');
    
    // Handle empty file case
    if (!data || data.trim() === '') {
      logger.warn('Empty pendingAcks file found, initializing with empty object');
      await fs.writeFile(pendingAcksFile, '{}');
      return;
    }
    
    try {
      const acks = JSON.parse(data);
      
      // Clear and fill the Map
      pendingSlackAcks.clear();
      for (const [key, value] of Object.entries(acks)) {
        pendingSlackAcks.set(key, value);
      }
      
      logger.info(`Loaded ${pendingSlackAcks.size} pending acks from disk`, {
        keys: Array.from(pendingSlackAcks.keys())
      });
    } catch (parseError) {
      logger.error('Error parsing pendingAcks JSON, resetting file:', parseError);
      // Reset the file if JSON is invalid
      await fs.writeFile(pendingAcksFile, '{}');
    }
  } catch (error) {
    logger.error('Error loading pending acks from disk:', error);
    // Still create an empty file to prevent future errors
    try {
      await fs.writeFile(pendingAcksFile, '{}');
    } catch (writeError) {
      logger.error('Failed to create empty pendingAcks file:', writeError);
    }
  }
}

// Save pending acks to disk with improved error handling
export async function savePendingAcksToDisk() {
  try {
    // Convert Map to an object
    const acks = {};
    for (const [key, value] of pendingSlackAcks.entries()) {
      acks[key] = value;
    }
    
    // Write to file with proper formatting
    await fs.writeFile(pendingAcksFile, JSON.stringify(acks, null, 2));
    logger.debug(`Saved ${pendingSlackAcks.size} pending acks to disk`);
    
    // Verify write operation was successful
    try {
      const data = await fs.readFile(pendingAcksFile, 'utf8');
      const parsed = JSON.parse(data);
      if (Object.keys(parsed).length !== pendingSlackAcks.size) {
        logger.warn('Mismatch between saved acks and memory state', {
          fileSize: Object.keys(parsed).length,
          memorySize: pendingSlackAcks.size
        });
      }
    } catch (verifyError) {
      logger.error('Error verifying saved state file:', verifyError);
    }
  } catch (error) {
    logger.error('Error saving pending acks to disk:', error);
  }
}

// Initialize state more robustly
export function initializeState() {
  // First, ensure the data directory exists
  fs.mkdir(stateDir, { recursive: true })
    .then(() => {
      logger.info('Data directory ensured');
      return loadPendingAcksFromDisk();
    })
    .catch(err => {
      logger.error('Error initializing state directory:', err);
    });
  
  // Set up auto-save interval
  setInterval(() => {
    savePendingAcksToDisk()
      .catch(err => logger.error('Auto-save error:', err));
  }, AUTO_SAVE_INTERVAL);
}

  // Listen for process exit to save state
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