import dotenv from 'dotenv';
dotenv.config();

// ensure variables are set
const requiredVars = ['TELEGRAM_BOT_TOKEN', 'SLACK_API_TOKEN', 'SLACK_CHANNEL_ID', 'ZENDESK_API_URL', 'ZENDESK_API_TOKEN'];
const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

export default {
    SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    SLACK_API_TOKEN: process.env.SLACK_API_TOKEN,
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL, // Keeping for backward compatibility
    ZENDESK_API_URL: process.env.ZENDESK_API_URL,
    ZENDESK_EMAIL: process.env.ZENDESK_EMAIL,
    ZENDESK_API_TOKEN: process.env.ZENDESK_API_TOKEN,
    DEPLOY_ENV: process.env.DEPLOY_ENV || 'development',
    // SEI team user IDs - allows forwarded messages to trigger alerts
    TEAM_MEMBERS: new Set([
      1705203106, // cordt
      5417931154, // tony
      508458486,  // jason
      1914543518, // lz
      727622784,  // mike
      612356857,  // gloria
      1236856398, // vasco
      603822657,  // jack
      1274153826, // eleanor
      1792978236, // speeks
      6662962364, // seiwizard
      1079207722, // justin
      888190133,  // larry
      1492431257, // brownhawk
      5408859523, // arman
      5167616557, // owen
      5052210248, // bryan
      7264719207, // saadman
      1677860359, // cody
      1739877429, // chad
      1413895364, // gerald
      5029879280, // bojack
      5154501005  // carson
    ])
};