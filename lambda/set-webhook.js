import axios from 'axios';

export const handler = async (event) => {
  try {
    console.log('Setting up webhook for Telegram bot...');
    
    // Get the bot token from environment variables
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is not set');
    }
    
    // Get the API Gateway URL (passed from the CDK stack)
    let webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error('WEBHOOK_URL environment variable is not set');
    }
    
    // Ensure the URL ends with the bot token path
    if (!webhookUrl.endsWith(`/${botToken}`)) {
      webhookUrl = `${webhookUrl}/${botToken}`;
    }
    
    console.log(`Setting webhook to URL: ${webhookUrl}`);
    
    // First, delete any existing webhook
    const deleteResponse = await axios.get(
      `https://api.telegram.org/bot${botToken}/deleteWebhook?drop_pending_updates=true`
    );
    console.log('Delete webhook response:', deleteResponse.data);
    
    // Wait briefly to ensure the webhook is deleted
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Set the new webhook
    const setResponse = await axios.get(
      `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}&allowed_updates=["message","callback_query"]`
    );
    console.log('Set webhook response:', setResponse.data);
    
    // Get webhook info to confirm
    const infoResponse = await axios.get(
      `https://api.telegram.org/bot${botToken}/getWebhookInfo`
    );
    console.log('Webhook info:', infoResponse.data);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Webhook set up successfully',
        webhookInfo: infoResponse.data
      })
    };
  } catch (error) {
    console.error('Error setting up webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to set up webhook',
        error: error.message
      })
    };
  }
};