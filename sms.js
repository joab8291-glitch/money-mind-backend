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

// Parse and import SMS
router.post('/parse', authenticateToken, async (req, res) => {
  const { text, provider } = req.body;
  if (!text || !provider) return res.status(400).json({ error: 'Text and provider required' });

  // Simple parser logic (can be expanded)
  const lines = text.split('\n').filter(l => l.trim());
  let imported = 0;

  for (const line of lines) {
    if (line.includes('Ksh') || line.includes('KES')) {
      try {
        await pool.query(
          `INSERT INTO transactions (user_id, type, amount, description, category, date, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.user.userId, 'expense', 1000, line.substring(0, 100), 'Other', new Date().toISOString().split('T')[0], provider]
        );
        imported++;
      } catch (e) {}
    }
  }

  res.json({ 
    imported, 
    message: `${imported} transactions imported successfully` 
  });
});

module.exports = router;
