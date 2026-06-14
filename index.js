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

// ==================== AUTH ROUTES ====================

// Register
app.post('/api/auth/register', async (req, res) => {
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
        
        res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
        if (err.code === '23505') {
            res.status(400).json({ error: 'Email already exists' });
        } else {
            res.status(500).json({ error: 'Registration failed' });
        }
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
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
        
        res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// ==================== TRANSACTIONS ROUTES ====================

// Middleware to verify token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

// Get all transactions for user
app.get('/api/transactions', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// Add transaction
app.post('/api/transactions', authenticateToken, async (req, res) => {
    const { type, amount, description, category, date } = req.body;
    
    try {
        const result = await pool.query(
            'INSERT INTO transactions (user_id, type, amount, description, category, date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [req.user.id, type, amount, description, category, date]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to add transaction' });
    }
});

// Delete transaction
app.delete('/api/transactions/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM transactions WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// ==================== BUDGET ROUTES ====================

// Get budget
app.get('/api/budget', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT budget FROM budgets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [req.user.id]
        );
        res.json({ budget: result.rows[0]?.budget || 0 });
    } catch (err) {
        res.json({ budget: 0 });
    }
});

// Set budget
app.post('/api/budget', authenticateToken, async (req, res) => {
    const { budget } = req.body;
    
    try {
        await pool.query(
            'INSERT INTO budgets (user_id, budget) VALUES ($1, $2)',
            [req.user.id, budget]
        );
        res.json({ message: 'Budget saved', budget });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save budget' });
    }
});

// ==================== SMS PARSE ROUTE ====================

app.post('/api/sms/parse', authenticateToken, async (req, res) => {
    const { text, provider } = req.body;
    
    // Simple SMS parsing logic
    const transactions = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
        // M-Pesa pattern
        const mpesaReceived = line.match(/Received Ksh([\d,]+) from ([^\n]+)/i);
        const mpesaSent = line.match(/Sent Ksh([\d,]+) to ([^\n]+)/i);
        const airtelReceived = line.match(/received KES ([\d,]+) from ([^\n]+)/i);
        const airtelSent = line.match(/sent KES ([\d,]+) to ([^\n]+)/i);
        
        let type, amount, description;
        
        if (mpesaReceived) {
            type = 'income';
            amount = parseFloat(mpesaReceived[1].replace(/,/g, ''));
            description = `M-Pesa: ${mpesaReceived[2]}`;
        } else if (mpesaSent) {
            type = 'expense';
            amount = parseFloat(mpesaSent[1].replace(/,/g, ''));
            description = `M-Pesa: ${mpesaSent[2]}`;
        } else if (airtelReceived) {
            type = 'income';
            amount = parseFloat(airtelReceived[1].replace(/,/g, ''));
            description = `Airtel: ${airtelReceived[2]}`;
        } else if (airtelSent) {
            type = 'expense';
            amount = parseFloat(airtelSent[1].replace(/,/g, ''));
            description = `Airtel: ${airtelSent[2]}`;
        } else {
            continue;
        }
        
        transactions.push({ type, amount, description, category: 'Other', date: new Date().toISOString().split('T')[0] });
    }
    
    // Save to database
    for (const tx of transactions) {
        await pool.query(
            'INSERT INTO transactions (user_id, type, amount, description, category, date) VALUES ($1, $2, $3, $4, $5, $6)',
            [req.user.id, tx.type, tx.amount, tx.description, tx.category, tx.date]
        );
    }
    
    res.json({ imported: transactions.length, transactions });
});

// ==================== AI CHAT ROUTE (Basic) ====================

app.post('/api/ai/chat', authenticateToken, async (req, res) => {
    const { message } = req.body;
    
    // Simple response for now - you can integrate Claude API later
    const responses = {
        'spending': 'Based on your transactions, track your daily expenses and set category limits.',
        'save': 'Try the 50/30/20 rule: 50% needs, 30% wants, 20% savings.',
        'default': `Thank you for your question about "${message}". Connect Claude API for advanced AI advice.`
    };
    
    let reply = responses.default;
    if (message.toLowerCase().includes('spend')) reply = responses.spending;
    if (message.toLowerCase().includes('save')) reply = responses.save;
    
    res.json({ reply });
});

// ==================== ROOT ROUTE ====================

app.get('/', (req, res) => {
    res.json({ message: 'MoneyMind Backend is running!', status: 'ok', endpoints: ['/api/auth/login', '/api/auth/register', '/api/transactions', '/api/budget', '/api/sms/parse', '/api/ai/chat'] });
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});