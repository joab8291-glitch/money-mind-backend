const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
        amount DECIMAL(12,2) NOT NULL,
        description TEXT,
        category VARCHAR(50),
        date DATE NOT NULL,
        source VARCHAR(20) DEFAULT 'manual',
        code TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source);
    `);
    console.log('✅ Database tables initialized successfully!');
  } catch (err) {
    console.error('❌ Database init failed:', err);
  } finally {
    await pool.end();
  }
}

initDB();
