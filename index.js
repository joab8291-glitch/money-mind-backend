const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// AI Provider SDKs
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Mistral } = require('@mistralai/mistralai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'moneymind_super_secret_key_change_me';

// ==================== INITIALIZE ALL AI PROVIDERS ====================

// Groq (Fastest, 30 req/min free)
let groq = null;
if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    console.log('✅ Groq AI initialized');
}

// Gemini (1,500 req/day free)
let genAI = null;
if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('✅ Gemini AI initialized');
}

// Mistral (1 req/sec free)
let mistral = null;
if (process.env.MISTRAL_API_KEY) {
    mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
    console.log('✅ Mistral AI initialized');
}

// Track which providers are available
const availableProviders = [];
if (groq) availableProviders.push('groq');
if (genAI) availableProviders.push('gemini');
if (mistral) availableProviders.push('mistral');

console.log(`📡 Available AI providers: ${availableProviders.join(', ') || 'NONE - using fallback mode'}`);

// ==================== TEST ROOT ROUTE ====================
app.get('/', (req, res) => {
    res.json({ 
        message: 'MoneyMind Backend is running!', 
        status: 'ok',
        ai_providers: availableProviders,
        endpoints: [
            'POST /api/auth/register',
            'POST /api/auth/login', 
            'GET /api/transactions',
            'POST /api/transactions',
            'DELETE /api/transactions/:id',
            'GET /api/budget',
            'POST /api/budget',
            'POST /api/sms/parse',
            'POST /api/ai/chat'
        ]
    });
});

// ==================== AUTH ROUTES ====================

// Register - POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
    console.log('📝 Register request received:', req.body.email);
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
            [name, email, hashedPassword]
        );
        
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        console.log('✅ User registered:', user.email);
        res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
        console.error('❌ Register error:', err);
        if (err.code === '23505') {
            res.status(400).json({ error: 'Email already exists' });
        } else {
            res.status(500).json({ error: 'Registration failed' });
        }
    }
});

// Login - POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    console.log('🔐 Login request received:', req.body.email);
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }
    
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        console.log('✅ User logged in:', user.email);
        res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
        console.error('❌ Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ==================== AUTHENTICATION MIDDLEWARE ====================

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// ==================== TRANSACTIONS ROUTES ====================

// GET all transactions - GET /api/transactions
app.get('/api/transactions', authenticateToken, async (req, res) => {
    console.log('📋 Fetching transactions for user:', req.user.id);
    try {
        const result = await pool.query(
            'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Fetch transactions error:', err);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// POST new transaction - POST /api/transactions
app.post('/api/transactions', authenticateToken, async (req, res) => {
    console.log('💰 Adding transaction for user:', req.user.id);
    const { type, amount, description, category, date } = req.body;
    
    if (!type || !amount || !description || !date) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
        const result = await pool.query(
            'INSERT INTO transactions (user_id, type, amount, description, category, date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [req.user.id, type, amount, description, category || 'Other', date]
        );
        console.log('✅ Transaction added:', result.rows[0].id);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('❌ Add transaction error:', err);
        res.status(500).json({ error: 'Failed to add transaction' });
    }
});

// DELETE transaction - DELETE /api/transactions/:id
app.delete('/api/transactions/:id', authenticateToken, async (req, res) => {
    console.log('🗑️ Deleting transaction:', req.params.id, 'for user:', req.user.id);
    try {
        const result = await pool.query(
            'DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        console.log('✅ Transaction deleted:', req.params.id);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        console.error('❌ Delete transaction error:', err);
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// ==================== BUDGET ROUTES ====================

// GET budget - GET /api/budget
app.get('/api/budget', authenticateToken, async (req, res) => {
    console.log('💰 Fetching budget for user:', req.user.id);
    try {
        const result = await pool.query(
            'SELECT budget FROM budgets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [req.user.id]
        );
        res.json({ budget: result.rows[0]?.budget || 0 });
    } catch (err) {
        console.error('❌ Fetch budget error:', err);
        res.json({ budget: 0 });
    }
});

// POST budget - POST /api/budget
app.post('/api/budget', authenticateToken, async (req, res) => {
    console.log('💰 Saving budget for user:', req.user.id, req.body);
    const { budget } = req.body;
    
    if (budget === undefined || isNaN(budget)) {
        return res.status(400).json({ error: 'Valid budget amount required' });
    }
    
    try {
        await pool.query(
            'INSERT INTO budgets (user_id, budget) VALUES ($1, $2)',
            [req.user.id, budget]
        );
        console.log('✅ Budget saved:', budget);
        res.json({ message: 'Budget saved', budget });
    } catch (err) {
        console.error('❌ Save budget error:', err);
        res.status(500).json({ error: 'Failed to save budget' });
    }
});

// ==================== SMS PARSE ROUTE ====================

app.post('/api/sms/parse', authenticateToken, async (req, res) => {
    console.log('📱 SMS parse request for user:', req.user.id);
    const { text, provider } = req.body;
    
    if (!text) {
        return res.status(400).json({ error: 'SMS text required' });
    }
    
    const transactions = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
        let type = null;
        let amount = null;
        let description = null;
        
        const mpesaReceived = line.match(/Received Ksh([\d,]+) from ([^\n]+)/i);
        const mpesaSent = line.match(/Sent Ksh([\d,]+) to ([^\n]+)/i);
        const mpesaReceived2 = line.match(/Ksh([\d,]+) received from ([^\n]+)/i);
        const mpesaSent2 = line.match(/Ksh([\d,]+) sent to ([^\n]+)/i);
        const airtelReceived = line.match(/received KES ([\d,]+) from ([^\n]+)/i);
        const airtelSent = line.match(/sent KES ([\d,]+) to ([^\n]+)/i);
        
        if (mpesaReceived || mpesaReceived2) {
            const match = mpesaReceived || mpesaReceived2;
            type = 'income';
            amount = parseFloat(match[1].replace(/,/g, ''));
            description = `M-Pesa: ${match[2]}`;
        } else if (mpesaSent || mpesaSent2) {
            const match = mpesaSent || mpesaSent2;
            type = 'expense';
            amount = parseFloat(match[1].replace(/,/g, ''));
            description = `M-Pesa: ${match[2]}`;
        } else if (airtelReceived) {
            type = 'income';
            amount = parseFloat(airtelReceived[1].replace(/,/g, ''));
            description = `Airtel: ${airtelReceived[2]}`;
        } else if (airtelSent) {
            type = 'expense';
            amount = parseFloat(airtelSent[1].replace(/,/g, ''));
            description = `Airtel: ${airtelSent[2]}`;
        }
        
        if (type && amount && description) {
            transactions.push({ 
                type, 
                amount, 
                description, 
                category: 'Other', 
                date: new Date().toISOString().split('T')[0] 
            });
        }
    }
    
    for (const tx of transactions) {
        await pool.query(
            'INSERT INTO transactions (user_id, type, amount, description, category, date) VALUES ($1, $2, $3, $4, $5, $6)',
            [req.user.id, tx.type, tx.amount, tx.description, tx.category, tx.date]
        );
    }
    
    console.log(`✅ SMS imported: ${transactions.length} transactions`);
    res.json({ imported: transactions.length, transactions });
});

// ==================== HELPER FUNCTIONS FOR AI ====================

async function getFinancialContext(userId) {
    const transactions = await pool.query(
        `SELECT type, amount, category, date 
         FROM transactions 
         WHERE user_id = $1 
         ORDER BY date DESC 
         LIMIT 30`,
        [userId]
    );
    
    const budgetResult = await pool.query(
        'SELECT budget FROM budgets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
    );
    
    const income = transactions.rows
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
        
    const expenses = transactions.rows
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
        
    const budget = budgetResult.rows[0]?.budget || 0;
    const balance = income - expenses;
    
    const expensesByCategory = {};
    transactions.rows.forEach(t => {
        if (t.type === 'expense') {
            const cat = t.category || 'Other';
            expensesByCategory[cat] = (expensesByCategory[cat] || 0) + parseFloat(t.amount);
        }
    });
    
    const topCategories = Object.entries(expensesByCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat, amt]) => `${cat}: KES ${amt.toLocaleString()}`)
        .join(', ');
    
    return { income, expenses, budget, balance, topCategories, transactionCount: transactions.rows.length };
}

function buildSystemPrompt(context) {
    return `You are MoneyMind AI, a friendly financial advisor for Kenyan users who use M-Pesa and Airtel Money.

USER'S REAL FINANCIAL DATA:
- Total Income: KES ${context.income.toLocaleString()}
- Total Expenses: KES ${context.expenses.toLocaleString()}
- Net Balance: KES ${context.balance.toLocaleString()}
- Monthly Budget: KES ${context.budget.toLocaleString()}
- Top Spending Categories: ${context.topCategories || 'No expenses yet'}

RULES:
1. Be concise (2-3 sentences)
2. Use Kenyan context (mention M-Pesa, KES)
3. If no data, guide user to add transactions
4. Be encouraging and practical
5. Never invent fake numbers`;
}

async function callAIWithFailover(systemPrompt, userMessage) {
    const errors = [];
    
    if (groq) {
        try {
            console.log('🔄 Trying Groq...');
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ],
                model: "llama3-70b-8192",
                temperature: 0.7,
                max_tokens: 300,
            });
            const reply = completion.choices[0]?.message?.content;
            if (reply) {
                console.log('✅ Groq succeeded');
                return { reply, provider: 'groq' };
            }
        } catch (err) {
            console.log(`⚠️ Groq failed: ${err.message}`);
            errors.push(`Groq: ${err.message}`);
        }
    }
    
    if (genAI) {
        try {
            console.log('🔄 Trying Gemini...');
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            const result = await model.generateContent(`${systemPrompt}\n\nUser: ${userMessage}`);
            const reply = result.response.text();
            if (reply) {
                console.log('✅ Gemini succeeded');
                return { reply, provider: 'gemini' };
            }
        } catch (err) {
            console.log(`⚠️ Gemini failed: ${err.message}`);
            errors.push(`Gemini: ${err.message}`);
        }
    }
    
    if (mistral) {
        try {
            console.log('🔄 Trying Mistral...');
            const response = await mistral.chat.complete({
                model: "mistral-tiny",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ]
            });
            const reply = response.choices[0]?.message?.content;
            if (reply) {
                console.log('✅ Mistral succeeded');
                return { reply, provider: 'mistral' };
            }
        } catch (err) {
            console.log(`⚠️ Mistral failed: ${err.message}`);
            errors.push(`Mistral: ${err.message}`);
        }
    }
    
    return { reply: null, errors };
}

// ==================== AI CHAT ROUTE ====================

app.post('/api/ai/chat', authenticateToken, async (req, res) => {
    console.log('🤖 AI chat request for user:', req.user.id);
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message required' });
    }
    
    try {
        const context = await getFinancialContext(req.user.id);
        
        if (context.transactionCount === 0) {
            return res.json({ 
                reply: "📭 You don't have any transactions yet. Add some expenses or income first, then I can give you personalized financial advice!"
            });
        }
        
        const systemPrompt = buildSystemPrompt(context);
        const result = await callAIWithFailover(systemPrompt, message);
        
        if (result.reply) {
            console.log(`✅ AI response sent via ${result.provider}`);
            return res.json({ reply: result.reply });
        }
        
        const lowerMsg = message.toLowerCase();
        let fallbackReply = '';
        
        if (lowerMsg.includes('spend') || lowerMsg.includes('expense')) {
            fallbackReply = `📊 Your total expenses: KES ${context.expenses.toLocaleString()}. Top category: ${context.topCategories || 'None yet'}. ${context.expenses > context.budget && context.budget > 0 ? `⚠️ You're over budget by KES ${(context.expenses - context.budget).toLocaleString()}!` : 'Keep tracking!'}`;
        } else if (lowerMsg.includes('save') || lowerMsg.includes('saving')) {
            fallbackReply = `💡 To save more: 1) Track daily M-Pesa spending 2) Reduce ${context.topCategories.split(',')[0] || 'unnecessary'} costs 3) Set a budget in Settings.`;
        } else if (lowerMsg.includes('budget')) {
            const percentUsed = context.budget > 0 ? (context.expenses / context.budget) * 100 : 0;
            fallbackReply = `💰 Budget: KES ${context.budget.toLocaleString()} | Spent: KES ${context.expenses.toLocaleString()} (${percentUsed.toFixed(0)}%). ${percentUsed > 80 ? '⚠️ Close to limit!' : 'You\'re on track!'}`;
        } else if (lowerMsg.includes('income')) {
            fallbackReply = `💵 Your total income: KES ${context.income.toLocaleString()}. Net balance: KES ${context.balance.toLocaleString()}. Great job!`;
        } else {
            fallbackReply = `👋 I see you've spent KES ${context.expenses.toLocaleString()} total. Ask me about: "spending", "saving", "budget", or "income" for insights based on your real data!`;
        }
        
        res.json({ reply: fallbackReply });
        
    } catch (error) {
        console.error('❌ AI Error:', error);
        res.json({ 
            reply: "🤖 AI service is temporarily unavailable. Check your Insights tab for spending patterns!" 
        });
    }
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 API available at: https://money-mind-backend-tzih.onrender.com`);
    console.log(`🤖 Available AI providers: ${availableProviders.join(', ') || 'NONE - fallback mode active'}`);
});