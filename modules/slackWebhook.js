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

// raw body for verification
app.use('/slack/interactions', (req, res, next) => {
    let data = '';
    req.on('data', chunk => {
        data += chunk.toString();
    });
    
    req.on('end', () => {
        req.rawBody = data;
        logger.debug('Raw body captured', { 
            size: data.length, 
            contentType: req.headers['content-type'],
            sample: data.length > 200 ? data.substring(0, 200) + '...' : data
        });
        next();
    });
});

// Parse URL-encoded data
app.use(bodyParser.urlencoded({ extended: true }));

// Parse JSON (fallback)
app.use(bodyParser.json());

// Global logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`, { 
        ip: req.ip,
        contentType: req.headers['content-type'],
        contentLength: req.headers['content-length']
    });
    
    logger.debug('Request headers', req.headers);
    
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

// Handle Slack interaction webhooks
app.post('/slack/interactions', async (req, res) => {
    logger.info('Received Slack interaction webhook');
    
    try {
        // Log the raw request for troubleshooting
        logger.debug('Raw request data', { 
            contentType: req.headers['content-type'],
            hasRawBody: !!req.rawBody,
            bodyKeys: Object.keys(req.body)
        });
        
        // Slack expects a response within 3 seconds
        // So we send a 200 OK response immediately, and process the true 'ack' asynchronously
        res.status(200).send('');
        
        // Continue processing in the background
        
        // Validate the request is coming from Slack in development mode
        if (!validateSlackRequest(req, config.SLACK_SIGNING_SECRET)) {
            logger.error('Invalid Slack request signature');
            return; // Already sent response
        }
        
        // Parse payload from form data or direct JSON
        let payload;
        if (req.body && req.body.payload) {
            try {
                logger.debug('Parsing payload from form data');
                payload = JSON.parse(req.body.payload);
            } catch (error) {
                logger.error('Error parsing payload from form data', error);
                return; // Already sent response
            }
        } else if (req.body && req.body.type) {
            // Handle direct JSON
            logger.debug('Using direct JSON payload');
            payload = req.body;
        } else {
            logger.error('No recognizable payload format', {
                body: req.body,
                rawBody: req.rawBody?.substring(0, 200)
            });
            return; // Already sent response
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
        // No need to send error response since we already sent 200 OK
    }
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