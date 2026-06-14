const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

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

// ==================== TEST ROOT ROUTE ====================
app.get('/', (req, res) => {
    res.json({ 
        message: 'MoneyMind Backend is running!', 
        status: 'ok', 
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
    console.log('📝 Register request received:', req.body);
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
    console.log('💰 Adding transaction for user:', req.user.id, req.body);
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
        
        // M-Pesa patterns
        const mpesaReceived = line.match(/Received Ksh([\d,]+) from ([^\n]+)/i);
        const mpesaSent = line.match(/Sent Ksh([\d,]+) to ([^\n]+)/i);
        const mpesaReceived2 = line.match(/Ksh([\d,]+) received from ([^\n]+)/i);
        const mpesaSent2 = line.match(/Ksh([\d,]+) sent to ([^\n]+)/i);
        
        // Airtel patterns
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
    
    // Save to database
    for (const tx of transactions) {
        await pool.query(
            'INSERT INTO transactions (user_id, type, amount, description, category, date) VALUES ($1, $2, $3, $4, $5, $6)',
            [req.user.id, tx.type, tx.amount, tx.description, tx.category, tx.date]
        );
    }
    
    console.log(`✅ SMS imported: ${transactions.length} transactions`);
    res.json({ imported: transactions.length, transactions });
});

// ==================== AI CHAT ROUTE ====================

app.post('/api/ai/chat', authenticateToken, async (req, res) => {
    console.log('🤖 AI chat request for user:', req.user.id);
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message required' });
    }
    
    // Get recent transactions for context
    const recentTx = await pool.query(
        'SELECT type, amount, category FROM transactions WHERE user_id = $1 ORDER BY date DESC LIMIT 10',
        [req.user.id]
    );
    
    const totalExpenses = recentTx.rows
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
    
    let reply = '';
    const lowerMsg = message.toLowerCase();
    
    if (lowerMsg.includes('spend') || lowerMsg.includes('expense')) {
        reply = `📊 Based on your last 10 transactions, you've spent KES ${totalExpenses.toLocaleString()}. Track categories like Food and Transport to identify savings opportunities.`;
    } else if (lowerMsg.includes('save') || lowerMsg.includes('saving')) {
        reply = `💡 Kenyan money-saving tips:\n1. Track M-Pesa expenses daily\n2. Use the 50/30/20 rule (Needs/Wants/Savings)\n3. Set a monthly budget in Settings\n4. Review your Insights tab for spending patterns`;
    } else if (lowerMsg.includes('budget')) {
        reply = `💰 Set your monthly budget in the Settings tab. I'll show you a progress bar when you approach your limit.`;
    } else {
        reply = `👋 Thanks for asking! I can help with:\n- Spending analysis\n- Saving tips\n- Budget tracking\n- M-Pesa/Airtel insights\n\nWhat would you like to know?`;
    }
    
    res.json({ reply });
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 API available at: https://money-mind-backend-tzih.onrender.com`);
});