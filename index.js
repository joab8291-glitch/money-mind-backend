require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'MoneyMind Backend v1.1 Running ✅',
    time: new Date().toISOString()
  });
});

// Routes - Files are in root (not in routes/ folder)
app.use('/api/auth', require('./auth'));
app.use('/api/transactions', require('./transactions'));
app.use('/api/sms', require('./sms'));
app.use('/api/budget', require('./budget'));
// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`🚀 MoneyMind Backend running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  pool.end();
  process.exit(0);
});
