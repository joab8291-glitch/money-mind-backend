const express = require('express');
const { authenticateToken } = require('./auth');
const { Pool } = require('pg');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

// Get monthly budget (per user)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT budget_amount, month_year FROM user_budgets WHERE user_id = $1 ORDER BY month_year DESC LIMIT 1',
      [req.user.userId]
    );
    res.json({ budget: result.rows[0] || { budget_amount: 0 } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch budget' });
  }
});

// Set budget
router.post('/', authenticateToken, async (req, res) => {
  const { amount, monthYear } = req.body; // e.g. "2026-06"

  try {
    await pool.query(`
      INSERT INTO user_budgets (user_id, budget_amount, month_year)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, month_year) 
      DO UPDATE SET budget_amount = EXCLUDED.budget_amount
    `, [req.user.userId, amount, monthYear || new Date().toISOString().slice(0,7)]);
    
    res.json({ message: 'Budget updated', budget: amount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save budget' });
  }
});

// Create budget table if not exists
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_budgets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        budget_amount DECIMAL(12,2) NOT NULL,
        month_year VARCHAR(7) NOT NULL,
        UNIQUE(user_id, month_year)
      );
    `);
  } catch (e) {}
})();

module.exports = router;
