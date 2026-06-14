const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  const jwt = require('jsonwebtoken');
  jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-change-in-production', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Get current budget
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM user_budgets WHERE user_id = $1 AND month_year = $2",
      [req.user.userId, new Date().toISOString().slice(0,7)]
    );
    res.json(result.rows[0] || { budget_amount: 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch budget' });
  }
});

// Save budget
router.post('/', authenticateToken, async (req, res) => {
  const { budget_amount } = req.body;
  const month_year = new Date().toISOString().slice(0,7);
  try {
    await pool.query(
      `INSERT INTO user_budgets (user_id, budget_amount, month_year)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, month_year) 
       DO UPDATE SET budget_amount = $2`,
      [req.user.userId, budget_amount, month_year]
    );
    res.json({ success: true, budget_amount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save budget' });
  }
});

module.exports = router;
