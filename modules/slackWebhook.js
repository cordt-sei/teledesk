// modules/slackWebhook.js
import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import config from '../config.js';
import { pendingSlackAcknowledgments } from './state.js';
import { validateSlackRequest, handleSlackAcknowledgment } from './slackIntegration.js';
import { Telegraf } from 'telegraf';
import createLogger from './logger.js';

// Initialize logger
const logger = createLogger('slackWebhook');

const PORT = process.env.PORT || 3030;
const app = express();
const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

// Simple liveness endpoint
app.get('/test', (req, res) => {
    logger.info('Test endpoint hit');
    res.send('Webhook server is running!');
});

// Global logging middleware
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

// DO NOT use the standard body parsers for the interactions endpoint
// Instead, use a specialized middleware that handles Slack's format

// For all other routes, parse JSON and URL-encoded data
app.use(/^(?!\/slack\/interactions).*$/, bodyParser.json());
app.use(/^(?!\/slack\/interactions).*$/, bodyParser.urlencoded({ extended: true }));

// Set up a specialized handler for the Slack interactions endpoint
app.post('/slack/interactions', async (req, res) => {
    logger.info('Received Slack interaction webhook');
    
    // Buffer the raw body first
    let rawBody = '';
    req.on('data', chunk => {
        rawBody += chunk.toString();
    });
    
    req.on('end', async () => {
        try {
            // Immediately respond to Slack to prevent timeout
            res.status(200).send('');
            
            // Store raw body for verification
            req.rawBody = rawBody;
            
            // Log raw request data
            logger.debug('Raw request data', {
                contentType: req.headers['content-type'],
                rawBodyLength: rawBody.length,
                rawBodyPreview: rawBody.substring(0, 100) + '...'
            });
            
            // Validating signature can continue in background
            const isValid = validateSlackRequest(req, config.SLACK_SIGNING_SECRET);
            if (!isValid && config.DEPLOY_ENV === 'production') {
                logger.error('Invalid Slack request signature in production');
                return; // Already sent response
            }
            
            // Parse the body based on content type
            let payload;
            
            if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
                // Parse URL-encoded form data
                const params = new URLSearchParams(rawBody);
                
                if (params.has('payload')) {
                    try {
                        payload = JSON.parse(params.get('payload'));
                        logger.debug('Parsed form-encoded payload successfully');
                    } catch (error) {
                        logger.error('Error parsing JSON from form payload', error);
                        return;
                    }
                } else {
                    logger.error('Form data missing payload parameter', {
                        params: Array.from(params.keys()).join(', ')
                    });
                    return;
                }
            } else if (req.headers['content-type']?.includes('application/json')) {
                // Parse JSON directly
                try {
                    payload = JSON.parse(rawBody);
                    logger.debug('Parsed JSON payload directly');
                } catch (error) {
                    logger.error('Error parsing direct JSON payload', error);
                    return;
                }
            } else {
                logger.error('Unsupported content type', {
                    contentType: req.headers['content-type']
                });
                return;
            }
            
            // Log significant payload details
            logger.info('Processing Slack payload', { 
                type: payload.type,
                actionCount: payload.actions?.length,
                user: payload.user?.username || payload.user?.name
            });
            
            // Handle acknowledgments
            if (payload.type === 'block_actions') {
                const result = await handleSlackAcknowledgment(bot, payload);
                logger.info('Acknowledgment handling result', { success: result });
            } else {
                logger.info('Ignoring non-block-actions payload', { type: payload.type });
            }
        } catch (error) {
            logger.error('Error processing webhook', error);
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Express error handler caught error', err);
    res.status(500).send('Internal Server Error');
});

// Start webhook server
function startServer() {
    app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Slack webhook handler listening on port ${PORT}`, {
            testUrl: `http://localhost:${PORT}/test`,
            interactionsUrl: `http://localhost:${PORT}/slack/interactions`
        });
    });
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