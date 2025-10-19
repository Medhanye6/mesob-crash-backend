// This file is used by server.js to send messages back to the user
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false }); // Do not poll, only use for notifications

const TMA_LINK = 'https://t.me/MesobEarnBot/MesobCrash'; // <<< UPDATE THIS URL!

// Function to send the notification to the user's chat
function sendNotification(telegramId, message) {
    bot.sendMessage(telegramId, message, {
        reply_markup: {
            inline_keyboard: [[
                { text: "🚀 Play Mesob Crash Again", web_app: { url: TMA_LINK } }
            ]]
        }
    })
    .catch(error => console.error(`Error sending message to ${telegramId}:`, error.message));
}

// Function for the bot to launch the Mini App (User hits /start)
// NOTE: This bot logic should run in parallel or be part of your main bot handler.
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Welcome to Mesob Crash! Tap below to bet and play.", {
        reply_markup: {
            inline_keyboard: [[
                { text: "🎰 Launch Mesob Crash", web_app: { url: TMA_LINK } }
            ]]
        }
    });
});

bot.on('polling_error', console.error); // Basic error handling

module.exports = { sendNotification, bot };
