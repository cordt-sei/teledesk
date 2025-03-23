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

// Load pending acks from disk
export async function loadPendingAcksFromDisk() {
  try {
    // Create state directory if it doesn't exist
    await fs.mkdir(stateDir, { recursive: true }).catch(() => {});
    
    // Check if file exists before loading
    try {
      await fs.access(pendingAcksFile);
    } catch (err) {
      // File doesn't exist, create it
      await fs.writeFile(pendingAcksFile, '{}');
      logger.info('Created new pendingAcks state file');
      return;
    }
    
    // Load the file
    const data = await fs.readFile(pendingAcksFile, 'utf8');
    const acks = JSON.parse(data);
    
    // Clear and fill the Map
    pendingSlackAcks.clear();
    for (const [key, value] of Object.entries(acks)) {
      pendingSlackAcks.set(key, value);
    }
    
    logger.info(`Loaded ${pendingSlackAcks.size} pending acks from disk`, {
      keys: Array.from(pendingSlackAcks.keys())
    });
  } catch (error) {
    logger.error('Error loading pending acks from disk:', error);
  }
}

// Save pending acks to disk
export async function savePendingAcksToDisk() {
  try {
    // Convert Map to an object
    const acks = {};
    for (const [key, value] of pendingSlackAcks.entries()) {
      acks[key] = value;
    }
    
    // Write to file
    await fs.writeFile(pendingAcksFile, JSON.stringify(acks, null, 2));
    logger.debug(`Saved ${pendingSlackAcks.size} pending acks to disk`);
  } catch (error) {
    logger.error('Error saving pending acks to disk:', error);
  }
}

// Setup auto-save interval (save every 10 seconds)
const AUTO_SAVE_INTERVAL = 10000; // 10 seconds

// Initialize auto-save
export function initializeState() {
  // First, load existing state
  loadPendingAcksFromDisk();
  
  // Set up auto-save interval
  setInterval(() => {
    savePendingAcksToDisk();
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