// modules/logger.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the current directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

// Default level from environment or INFO
const DEFAULT_LEVEL = process.env.LOG_LEVEL ? 
  (LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] || LOG_LEVELS.INFO) : 
  LOG_LEVELS.INFO;

class Logger {
  constructor(module, level = DEFAULT_LEVEL) {
    this.module = module;
    this.level = level;
    
    // Ensure log directory exists
    this.ensureLogDir();
  }
  
  async ensureLogDir() {
    try {
      await fs.mkdir(logsDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create logs directory:', err);
    }
  }
  
  getTimestamp() {
    return new Date().toISOString();
  }
  
  formatLog(level, message, data) {
    const timestamp = this.getTimestamp();
    let logMessage = `[${timestamp}] [${level}] [${this.module}] ${message}`;
    
    if (data) {
      // Handle Error objects specially
      if (data instanceof Error) {
        logMessage += `\n  Error: ${data.message}\n  Stack: ${data.stack}`;
      } else if (typeof data === 'object') {
        try {
          logMessage += `\n  ${JSON.stringify(data, null, 2)}`;
        } catch (e) {
          logMessage += `\n  [Object that couldn't be stringified]`;
        }
      } else {
        logMessage += `\n  ${data}`;
      }
    }
    
    return logMessage;
  }
  
  async writeToFile(message) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(logsDir, `${today}.log`);
      
      await fs.appendFile(logFile, message + '\n');
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  }
  
  log(level, levelName, message, data) {
    if (level <= this.level) {
      const logMessage = this.formatLog(levelName, message, data);
      
      // Output to console
      const consoleMethod = level === LOG_LEVELS.ERROR ? 'error' : 
        level === LOG_LEVELS.WARN ? 'warn' : 'log';
      console[consoleMethod](logMessage);
      
      // Write to file
      this.writeToFile(logMessage);
    }
  }
  
  error(message, data) {
    this.log(LOG_LEVELS.ERROR, 'ERROR', message, data);
  }
  
  warn(message, data) {
    this.log(LOG_LEVELS.WARN, 'WARN', message, data);
  }
  
  info(message, data) {
    this.log(LOG_LEVELS.INFO, 'INFO', message, data);
  }
  
  debug(message, data) {
    this.log(LOG_LEVELS.DEBUG, 'DEBUG', message, data);
  }
  
  trace(message, data) {
    this.log(LOG_LEVELS.TRACE, 'TRACE', message, data);
  }
}

// Export a factory function to create loggers for different modules
export default function createLogger(module) {
  return new Logger(module);
}