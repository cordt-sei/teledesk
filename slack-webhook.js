import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import axios from 'axios';
import config from './config.js';
import { bot, pendingSlackAcknowledgments } from './bot.js';

const app = express();

// Add a simple test endpoint
app.get('/test', (req, res) => {
    console.log('Test endpoint hit');
    res.send('Webhook server is running!');
});

// Capture the raw body for verification
app.use('/slack/interactions', (req, res, next) => {
    let data = '';
    req.on('data', chunk => {
        data += chunk;
    });
    
    req.on('end', () => {
        req.rawBody = data;
        next();
    });
});

// Parse JSON bodies (after capturing raw body)
app.use(bodyParser.json());

// Validate Slack requests
function validateSlackRequest(req) {
    const slackSigningSecret = config.SLACK_SIGNING_SECRET;
    
    // If no signing secret is configured, skip validation in development
    if (!slackSigningSecret && config.DEPLOY_ENV !== 'production') {
        console.warn('⚠️ Slack signing secret not configured. Skipping validation in development mode.');
        return true;
    }
    
    if (!slackSigningSecret) {
        console.error('❌ Slack signing secret not configured.');
        return false;
    }
    
    const slackSignature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];
    const body = req.rawBody || JSON.stringify(req.body);
    
    if (!slackSignature || !timestamp) {
        console.error('❌ Missing Slack headers:', { 
            hasSignature: !!slackSignature, 
            hasTimestamp: !!timestamp 
        });
        return false;
    }
    
    // Check if timestamp is recent (prevent replay attacks)
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - timestamp) > 300) {
        console.error('❌ Request timestamp too old:', { 
            requestTime: timestamp, 
            currentTime, 
            difference: Math.abs(currentTime - timestamp) 
        });
        return false;
    }
    
    // Generate our own signature
    const sigBaseString = `v0:${timestamp}:${body}`;
    const signature = 'v0=' + crypto
        .createHmac('sha256', slackSigningSecret)
        .update(sigBaseString)
        .digest('hex');
    
    // Use constant-time comparison
    try {
        const isValid = crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(slackSignature)
        );
        
        if (!isValid) {
            console.error('❌ Invalid signature');
        }
        
        return isValid;
    } catch (e) {
        console.error('❌ Error validating signature:', e);
        return false;
    }
}

// Handle Slack interaction webhooks
app.post('/slack/interactions', async (req, res) => {
    console.log('Received Slack interaction webhook');
    
    // Validate the request is coming from Slack
    if (!validateSlackRequest(req)) {
        console.error('❌ Invalid Slack request signature');
        return res.status(401).send('Unauthorized');
    }
    
    // Log headers and body for debugging
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    
    try {
        // Parse the payload
        const payload = JSON.parse(req.body.payload || '{}');
        console.log('Parsed payload:', JSON.stringify(payload, null, 2));
        
        // Handle button clicks
        if (payload.type === 'block_actions') {
            // Check if this is our acknowledge button
            const action = payload.actions && payload.actions[0];
            if (action && action.action_id === 'acknowledge_forward') {
                const messageTs = payload.message.ts;
                const userId = payload.user.id;
                const userName = payload.user.username || payload.user.name;
                
                console.log(`✅ Acknowledgment received from ${userName} for message ${messageTs}`);
                
                if (pendingSlackAcknowledgments.has(messageTs)) {
                    const pendingInfo = pendingSlackAcknowledgments.get(messageTs);
                    
                    // Send acknowledgment back to Telegram
                    try {
                        await bot.telegram.sendMessage(
                            pendingInfo.telegramChatId,
                            `✅ Your forwarded message has been acknowledged by ${userName} in Slack.`
                        );
                        
                        // Update the Slack message to show who acknowledged it
                        await axios.post('https://slack.com/api/chat.update', {
                            channel: payload.channel.id,
                            ts: messageTs,
                            text: payload.message.text + `\n\n✅ Acknowledged by <@${userId}>`,
                            blocks: [
                                {
                                    type: "section",
                                    text: {
                                        type: "mrkdwn",
                                        text: payload.message.text
                                    }
                                },
                                {
                                    type: "context",
                                    elements: [
                                        {
                                            type: "mrkdwn",
                                            text: `✅ Acknowledged by <@${userId}> at ${new Date().toLocaleString()}`
                                        }
                                    ]
                                }
                            ]
                        }, {
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${config.SLACK_API_TOKEN}`
                            }
                        });
                        
                        // Remove from pending list
                        pendingSlackAcknowledgments.delete(messageTs);
                        console.log(`✅ Acknowledgment processed successfully for message ${messageTs}`);
                    } catch (error) {
                        console.error('❌ Error processing acknowledgment:', error);
                    }
                } else {
                    console.log(`❓ No pending acknowledgment found for message ${messageTs}`);
                }
            }
        }
    } catch (error) {
        console.error('❌ Error processing webhook:', error);
    }
    
    // Always acknowledge receipt of the interaction to Slack
    res.status(200).send('');
});

// Start the server
const PORT = process.env.PORT || 3030;
app.listen(PORT, () => {
    console.log(`Slack webhook handler listening on port ${PORT}`);
    console.log(`Test URL: http://localhost:${PORT}/test`);
    console.log(`Interactions URL: http://localhost:${PORT}/slack/interactions`);
});

export { app };