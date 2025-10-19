require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { initDB, getUser, updateBalance, createWager, updateWagerStatus } = require('./db_logic'); // Assuming database logic file

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const JWT_SECRET = process.env.JWT_SECRET;
const TMA_URL = 'YOUR_FRONTEND_VERCEL_URL'; // e.g., https://mesob-crash-tma.vercel.app

// ----------------------------------------------------
// 1. MIDDLEWARES & INIT
// ----------------------------------------------------

app.use(cors({ origin: TMA_URL }));
app.use(express.json());

// Placeholder for database initialization
initDB();

// Anti-Cheat: Telegram InitData Validation (Simplified Check)
// !!! WARNING: This is a complex security function. Use a well-tested library in production.
const validateInitData = (initData) => {
    // Basic Structure check (actual validation needs HMAC-SHA256 crypto)
    if (!initData || !initData.includes('user=')) return null;
    try {
        const userMatch = initData.match(/user=([^&]+)/);
        if (!userMatch) return null;
        return JSON.parse(decodeURIComponent(userMatch[1])).id; // Returns Telegram ID
    } catch {
        return null;
    }
};

// Middleware: Authenticate JWT
const jwtVerifyMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({ message: 'Authentication required.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user_id = payload.user_id;
        next();
    } catch (err) {
        return res.status(401).send({ message: 'Invalid or expired token.' });
    }
};

// ----------------------------------------------------
// 2. AUTHENTICATION API
// ----------------------------------------------------

app.post('/api/tma/auth', async (req, res) => {
    const { initData } = req.body;
    const telegramId = validateInitData(initData);

    if (!telegramId) {
        return res.status(401).send({ success: false, message: 'Invalid Telegram data.' });
    }

    const user = await getUser(telegramId);
    
    const token = jwt.sign({ user_id: telegramId, session_id: Date.now() }, JWT_SECRET, { expiresIn: '1h' });

    return res.json({
        success: true,
        token: token,
        balance: user.etb_balance, 
    });
});

// ----------------------------------------------------
// 3. GAME API (Protected by JWT)
// ----------------------------------------------------

// Endpoint: Place Bet (Deducts funds)
app.post('/api/game/wager', jwtVerifyMiddleware, async (req, res) => {
    const userId = req.user_id;
    const betAmount = parseFloat(req.body.bet_amount);
    
    if (isNaN(betAmount) || betAmount <= 0) {
        return res.status(400).send({ message: 'Invalid bet amount.' });
    }

    try {
        const user = await getUser(userId);
        if (user.etb_balance < betAmount) {
            return res.status(400).send({ message: 'Insufficient funds.' });
        }

        // --- ATOMIC DEDUCTION ---
        await updateBalance(userId, -betAmount);
        const gameId = await createWager(userId, betAmount); // Creates ACTIVE wager record

        return res.json({ 
            success: true, 
            game_id: gameId, 
            new_balance: user.etb_balance - betAmount
        });

    } catch (error) {
        console.error('Wager error:', error);
        return res.status(500).send({ message: 'Server error during wager.' });
    }
});

// Endpoint: Cash Out (Win Payout)
app.post('/api/game/cashout', jwtVerifyMiddleware, async (req, res) => {
    const userId = req.user_id;
    const { game_id, claimed_multiplier } = req.body;
    const cashoutTime = Date.now();

    try {
        const wager = await getWager(game_id);
        if (!wager || wager.user_id !== userId || wager.status !== 'ACTIVE') {
            throw new Error('Invalid or expired wager.');
        }

        const betAmount = wager.bet_amount;
        
        // --- CRITICAL ANTI-CHEAT: SERVER-SIDE TIME CHECK ---
        const elapsedTime = (cashoutTime - wager.wager_start_time) / 1000;
        
        // The multiplier formula must be replicated securely here
        const EXPECTED_MULTIPLIER = 1 + (elapsedTime * 0.15); // Example: 0.15x per second

        // Check for cheating (e.g., claimed multiplier is too high for the time played)
        if (claimed_multiplier > (EXPECTED_MULTIPLIER * 1.05)) { // 5% tolerance
             await updateWagerStatus(game_id, 'FRAUD');
             return res.status(403).send({ message: 'Fraud detected. Wager voided.' });
        }

        const finalMultiplier = claimed_multiplier;
        const winnings = betAmount * finalMultiplier;

        // --- ATOMIC CREDIT ---
        await updateBalance(userId, winnings);
        await updateWagerStatus(game_id, 'PAID', finalMultiplier);

        // Notify user via Telegram Bot (Send the final message)
        const { sendNotification } = require('./bot'); 
        sendNotification(userId, `✅ You cashed out at ${finalMultiplier.toFixed(2)}x and won ${winnings.toFixed(2)} ETB!`);
        
        const newBalance = (await getUser(userId)).etb_balance;

        return res.json({ success: true, winnings: winnings, final_multiplier: finalMultiplier, new_balance: newBalance });

    } catch (error) {
        console.error('Cashout error:', error);
        return res.status(500).send({ message: 'Server error during payout.' });
    }
});

// Endpoint: Crash (Loss)
app.post('/api/game/crash', jwtVerifyMiddleware, async (req, res) => {
    const userId = req.user_id;
    const { game_id } = req.body;
    
    try {
        const wager = await getWager(game_id);
        if (wager && wager.user_id === userId && wager.status === 'ACTIVE') {
            await updateWagerStatus(game_id, 'LOST');
            const { sendNotification } = require('./bot');
            sendNotification(userId, `❌ Game Over! You crashed and lost your ${wager.bet_amount} ETB bet.`);
            return res.json({ success: true });
        }
        return res.status(400).send({ message: 'No active wager found.' });
    } catch (error) {
        console.error('Crash error:', error);
        return res.status(500).send({ message: 'Server error on crash log.' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
