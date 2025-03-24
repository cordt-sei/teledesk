// modules/slackWebhook.js
import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import config from '../config.js';
import { 
  pendingSlackAcks, 
  initializeState, 
  setupShutdownHandlers,
  savePendingAcksToDisk
} from './state.js';
import { validateSlackRequest } from './slackIntegration.js';
import createLogger from './logger.js';

// Initialize logger
const logger = createLogger('slackWebhook');

// Initialize state persistence
initializeState();
setupShutdownHandlers();

const PORT = process.env.PORT || 3030;
const app = express();

// Log the state of pendingSlackAcks for debugging
logger.debug('pendingSlackAcks in slackWebhook.js at startup:', {
    isMap: pendingSlackAcks instanceof Map,
    size: pendingSlackAcks.size,
    keys: Array.from(pendingSlackAcks.keys())
});

// ===== MIDDLEWARE SETUP =====
// Global logging middleware - MUST come first
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`, { 
        ip: req.ip,
        contentType: req.headers['content-type']
    });
    
    // Enhanced response logging
    const originalSend = res.send;
    res.send = function(body) {
        logger.debug('Response', { 
            statusCode: res.statusCode,
            body: typeof body === 'string' ? body : '[non-string response]'
        });
        return originalSend.call(this, body);
    };
    
    next();
});

// Use standard body parsers for most routes
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Special handling for Slack interactions endpoint
app.use('/slack/interactions', (req, res, next) => {
    // Buffer the raw body first
    let rawBody = '';
    req.on('data', chunk => {
        rawBody += chunk.toString();
    });
    
    req.on('end', () => {
        req.rawBody = rawBody; // Store raw body for Slack signature verification
        next();
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Express error handler caught error', err);
    res.status(500).send('Internal Server Error');
});

// ===== ROUTE DEFINITIONS =====
// Simple liveness endpoint
app.get('/test', (req, res) => {
    logger.info('Test endpoint hit');
    res.send('Webhook server is running!');
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

// Debug endpoint to check pending Acks
app.get('/debug-acks', (req, res) => {
    if (config.DEPLOY_ENV !== 'production') {
        logger.info('Debug endpoint checking Acks');
        const acks = Array.from(pendingSlackAcks.entries()).map(([key, value]) => ({
            messageTs: key,
            chatId: value.telegramChatId,
            timestamp: new Date(value.timestamp).toISOString(),
            hasStatusMessageId: !!value.statusMessageId
        }));
        res.json({
            count: pendingSlackAcks.size,
            items: acks
        });
    } else {
        res.status(403).send('Forbidden in production');
    }
});

// Simplified Slack interactions endpoint - only kept for compatibility
app.post('/slack/interactions', (req, res) => {
    logger.info('Received Slack interaction webhook - no longer used for acknowledgments');
    
    try {
        // CRITICAL: IMMEDIATELY respond to Slack to avoid timeout
        // We don't need to process anything anymore, just acknowledge
        res.status(200).send('');
        
        // Optionally log the event type for debugging
        try {
            const rawBody = req.rawBody;
            if (rawBody) {
                if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
                    const params = new URLSearchParams(rawBody);
                    if (params.has('payload')) {
                        const payload = JSON.parse(params.get('payload'));
                        logger.debug('Received unused interaction', { 
                            type: payload.type,
                            action: payload.actions?.[0]?.action_id
                        });
                    }
                }
            }
        } catch (error) {
            // Just log and ignore any parsing errors - we don't need this data
            logger.debug('Could not parse interaction payload', error);
        }
    } catch (error) {
        logger.error('Error in Slack interactions endpoint:', error);
        // Still send 200 OK even if there's an error
        res.status(200).send('');
    }
});

// Test endpoint for directly acknowledging messages (kept as manual fallback)
app.post('/test-acknowledge', async (req, res) => {
    try {
        logger.info('Manual acknowledgment endpoint hit');
        logger.debug('Request body:', req.body);
        
        const { messageTs, chatId, userName } = req.body;
        
        if (!chatId) {
            return res.status(400).json({ 
                error: 'Missing required parameters', 
                required: ['chatId'],
                received: req.body 
            });
        }
        
        // Use a fake message timestamp if not provided
        const finalMessageTs = messageTs || `test_${Date.now()}.${Math.floor(Math.random() * 1000)}`;
        
        logger.info(`Processing manual acknowledgment for chat ${chatId}`);
        
        // Check if this message is in pending acks
        let statusMessageId = null;
        if (pendingSlackAcks.has(finalMessageTs)) {
            const pendingInfo = pendingSlackAcks.get(finalMessageTs);
            statusMessageId = pendingInfo.statusMessageId;
            logger.info(`Found pending ack with status message ID: ${statusMessageId}`);
        }
        
        // Send the ack directly via Telegram API
        const ackTime = new Date().toLocaleString();
        const displayName = userName || 'Test User';
        const message = `🟢 Your forwarded message has been acknowledged by ${displayName} at ${ackTime}.`;
        
        try {
            let telegramResponse;
            let messageWasSent = false;
            
            // Try to update existing message if we have status message ID
            if (statusMessageId) {
                try {
                    telegramResponse = await axios.post(
                        `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/editMessageText`,
                        {
                            chat_id: chatId,
                            message_id: statusMessageId,
                            text: message
                        }
                    );
                    
                    if (telegramResponse.data.ok) {
                        logger.info('Successfully updated existing status message');
                        messageWasSent = true;
                    } else {
                        logger.warn('Failed to update status message, falling back to new message');
                    }
                } catch (error) {
                    logger.warn('Error updating status message, falling back to new message:', error.message);
                }
            }
            
            // Send as new message if updating failed or we didn't have a status message ID
            if (!messageWasSent) {
                telegramResponse = await axios.post(
                    `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
                    {
                        chat_id: chatId,
                        text: message
                    }
                );
                
                if (telegramResponse.data.ok) {
                    logger.info('Successfully sent new ack message');
                    messageWasSent = true;
                } else {
                    throw new Error('Failed to send new message');
                }
            }
            
            // Remove from pending acks if it exists
            if (pendingSlackAcks.has(finalMessageTs)) {
                pendingSlackAcks.delete(finalMessageTs);
                await savePendingAcksToDisk();
                logger.info(`Removed message ${finalMessageTs} from pending acks`);
            }
            
            res.json({
                success: true,
                message: 'Acknowledgment sent successfully',
                telegramMessageId: telegramResponse.data.result?.message_id
            });
        } catch (error) {
            logger.error('Error sending manual acknowledgment:', error);
            res.status(500).json({ 
                error: 'Failed to send acknowledgment', 
                details: error.message 
            });
        }
    } catch (error) {
        logger.error('Error in test-acknowledge endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== SERVER HANDLING =====
let server;

function startServer() {
    try {
        // Create the server
        server = app.listen(PORT, '0.0.0.0', () => {
            logger.info(`Slack webhook handler listening on port ${PORT}`, {
                testUrl: `http://localhost:${PORT}/test`,
                healthUrl: `http://localhost:${PORT}/health`
            });
            
            // Signal ready to PM2
            if (process.send) {
                process.send('ready');
                logger.info('Sent ready signal to process manager');
            }
        });
        
        // Add error handler
        server.on('error', (err) => {
            logger.error(`Server error: ${err.message}`);
            if (err.code === 'EADDRINUSE') {
                logger.error(`Port ${PORT} is already in use. Exiting.`);
                process.exit(1); // Exit with error
            }
        });
        
        return server;
    } catch (err) {
        logger.error(`Failed to start server: ${err.message}`);
        process.exit(1); // Exit with error
    }
}

// shutdown handling
function shutdownServer() {
    return new Promise((resolve) => {
        if (!server) {
            logger.info('No server to shutdown');
            return resolve();
        }
        
        logger.info('Shutting down webhook server...');
        server.close((err) => {
            if (err) {
                logger.error('Error closing server:', err);
            } else {
                logger.info('Server shutdown complete');
            }
            resolve();
        });
        
        // Force close after timeout
        setTimeout(() => {
            logger.warn('Forcing server shutdown after timeout');
            resolve();
        }, 5000);
    });
}

// Process uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason, promise });
});

async function handleShutdown(signal) {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    try {
        // Save state
        await savePendingAcksToDisk();
        logger.info('Saved pending acknowledgments');
        
        // Shutdown server
        await shutdownServer();
        
        // Allow some time for cleanup before exiting
        setTimeout(() => {
            logger.info('Clean shutdown complete');
            process.exit(0);
        }, 1000);
    } catch (err) {
        logger.error('Error during shutdown:', err);
        process.exit(1);
    }
}

process.once('SIGINT', () => handleShutdown('SIGINT'));
process.once('SIGTERM', () => handleShutdown('SIGTERM'));

// Only start the server when explicitly enabled
if (process.env.WEBHOOK_PROCESS === 'true') {
    logger.info('Starting webhook server');
    startServer();
} else {
    logger.info('Webhook server not started (WEBHOOK_PROCESS != true)');
}

export { app, startServer, shutdownServer };