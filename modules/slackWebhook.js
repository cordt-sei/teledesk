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

// Test endpoint for directly acknowledging messages
app.post('/test-acknowledge', async (req, res) => {
    try {
        logger.info('Test acknowledge endpoint hit');
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
        
        logger.info(`Processing test acknowledgment for chat ${chatId}`);
        
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
            logger.error('Error sending test acknowledgment:', error);
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

// Simplified Slack interactions endpoint
app.post('/slack/interactions', (req, res) => {
    logger.info('Received Slack interaction webhook');
    
    try {
        // Process the raw body
        const rawBody = req.rawBody;
        
        if (!rawBody) {
            logger.error('No raw body available');
            return res.status(400).send(''); // Quick error response
        }
        
        // Parse the payload quickly
        let payload;
        
        if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
            const params = new URLSearchParams(rawBody);
            if (params.has('payload')) {
                try {
                    payload = JSON.parse(params.get('payload'));
                } catch (error) {
                    return res.status(400).send(''); // Quick error response
                }
            } else {
                return res.status(400).send(''); // Quick error response
            }
        } else if (req.headers['content-type']?.includes('application/json')) {
            try {
                payload = JSON.parse(rawBody);
            } catch (error) {
                return res.status(400).send(''); // Quick error response
            }
        } else {
            return res.status(400).send(''); // Quick error response
        }
        
        // IMMEDIATELY respond to Slack to avoid timeout
        res.status(200).send('');
        
        // Process the payload asynchronously in the background
        processSlackPayload(payload).catch(error => {
            logger.error('Error processing Slack payload:', error);
        });
        
    } catch (error) {
        logger.error('Error in Slack interactions endpoint:', error);
        res.status(200).send(''); // Still respond to avoid Slack errors
    }
});

// ===== HELPER FUNCTIONS =====
/**
 * Process a Slack payload
 */
async function processSlackPayload(payload) {
    try {
        // Log significant payload details
        logger.info('Processing Slack payload', { 
            type: payload.type,
            actionCount: payload.actions?.length,
            user: payload.user?.username || payload.user?.name
        });
        
        // Handle Acks using direct approach for Telegram
        if (payload.type === 'block_actions' && 
            payload.actions && 
            payload.actions[0]?.action_id === 'acknowledge_forward') {
            
            const messageTs = payload.message.ts;
            const userName = payload.user.username || payload.user.name || 'Unknown User';
            const userId = payload.user.id;
            
            logger.info(`Processing acknowledgment from ${userName} for message ${messageTs}`);
            
            // Enhanced logging for debugging
            logger.debug('Current pendingSlackAcks:', {
                size: pendingSlackAcks.size,
                keys: Array.from(pendingSlackAcks.keys()),
                exactMatch: pendingSlackAcks.has(messageTs)
            });
            
            // Check if we have pending ack info for this message
            if (pendingSlackAcks.has(messageTs)) {
                const pendingInfo = pendingSlackAcks.get(messageTs);
                logger.debug('Found pending ack info', pendingInfo);
                
                // Verify we have the required information
                if (!pendingInfo.telegramChatId) {
                    logger.error('Missing telegramChatId in pending ack info');
                    return;
                }
                
                const chatId = pendingInfo.telegramChatId;
                const statusMessageId = pendingInfo.statusMessageId;
                
                // Format timestamp for the message
                const ackTime = new Date().toLocaleString();
                const ackMessage = `🟢 Your forwarded message has been acknowledged by ${userName} at ${ackTime}.`;
                
                // Send ack to Telegram directly - this is our primary method
                try {
                    let telegramResponse;
                    let messageWasSent = false;
                    
                    // First try to update existing status message if we have one
                    if (statusMessageId) {
                        try {
                            telegramResponse = await axios.post(
                                `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/editMessageText`,
                                {
                                    chat_id: chatId,
                                    message_id: statusMessageId,
                                    text: ackMessage
                                }
                            );
                            
                            if (telegramResponse.data.ok) {
                                logger.info(`Successfully updated status message ${statusMessageId} for chat ${chatId}`);
                                messageWasSent = true;
                            } else {
                                logger.warn('Failed to update status message', telegramResponse.data);
                            }
                        } catch (editError) {
                            logger.warn('Error updating status message, falling back to new message:', editError.message);
                        }
                    }
                    
                    // If updating failed or we didn't have a status message ID, send a new message
                    if (!messageWasSent) {
                        try {
                            telegramResponse = await axios.post(
                                `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
                                {
                                    chat_id: chatId,
                                    text: ackMessage
                                }
                            );
                            
                            if (telegramResponse.data.ok) {
                                logger.info(`Successfully sent new ack message to chat ${chatId}`);
                                messageWasSent = true;
                            } else {
                                logger.error('Failed to send new message', telegramResponse.data);
                            }
                        } catch (sendError) {
                            logger.error('Error sending new message to Telegram:', sendError.message);
                        }
                    }
                    
                    // Update Slack message with acknowledge info
                    try {
                        await updateSlackMessageWithAck(
                            payload.channel.id,
                            messageTs,
                            payload.message,
                            userId,
                            userName,
                            !messageWasSent // Mark as fallback if Telegram messaging failed
                        );
                        logger.info('Updated Slack message with acknowledgment info');
                    } catch (slackError) {
                        logger.error('Error updating Slack message:', slackError.message);
                    }
                    
                    // Remove from pending list regardless of outcome
                    pendingSlackAcks.delete(messageTs);
                    
                    // Update the stored state
                    await savePendingAcksToDisk();
                    
                    logger.info(`Finished processing ack for message ${messageTs}`);
                } catch (error) {
                    logger.error('Error during acknowledgment processing:', error);
                }
            } else {
                logger.warn(`No pending Ack found for message ${messageTs}`);
                
                // Update Slack message anyway
                try {
                    await updateSlackMessageWithAck(
                        payload.channel.id,
                        messageTs,
                        payload.message,
                        userId,
                        userName,
                        true // Mark as fallback mode
                    );
                    logger.info('Updated Slack message, but no Telegram notification sent (no matching pending Ack)');
                } catch (error) {
                    logger.error('Error updating Slack message:', error);
                }
            }
        } else {
            logger.info('Ignoring non-acknowledgment payload', { 
                type: payload.type,
                actionId: payload.actions?.[0]?.action_id
            });
        }
    } catch (error) {
        logger.error('Error processing Slack payload:', error);
    }
}

/**
 * Helper function to update Slack message with Ack info
 */
async function updateSlackMessageWithAck(channelId, messageTs, originalMessage, userId, userName, isFallback = false) {
  try {
    // Keep original blocks but remove the action button
    const originalBlocks = originalMessage.blocks || [];
    const updatedBlocks = originalBlocks
      .filter(block => block.type !== 'actions')
      .concat([
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `🟢 Acknowledged by <@${userId}> at ${new Date().toLocaleString()}${isFallback ? ' (no Telegram notification sent)' : ''}`
            }
          ]
        }
      ]);
    
    const response = await axios.post('https://slack.com/api/chat.update', {
      channel: channelId,
      ts: messageTs,
      blocks: updatedBlocks
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
      }
    });
    
    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }
    
    return true;
  } catch (error) {
    logger.error('Error updating Slack message:', error);
    return false;
  }
}

// ===== SERVER HANDLING =====
function startServer() {
    try {
        // First try to detect if port is in use
        const server = app.listen(PORT, '0.0.0.0', () => {
            logger.info(`Slack webhook handler listening on port ${PORT}`, {
                testUrl: `http://localhost:${PORT}/test`,
                interactionsUrl: `http://localhost:${PORT}/slack/interactions`
            });
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

// Process uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason, promise });
});

// Only start the server when explicitly enabled
if (process.env.WEBHOOK_PROCESS === 'true') {
    logger.info('Starting webhook server');
    startServer();
} else {
    logger.info('Webhook server not started (WEBHOOK_PROCESS != true)');
}

export { app, startServer };