import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;

async function clearWebhook() {
  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${botToken}/deleteWebhook?drop_pending_updates=true`
    );
    console.log('Webhook cleared:', response.data);
  } catch (error) {
    console.error('Error clearing webhook:', error);
  }
}

clearWebhook();
