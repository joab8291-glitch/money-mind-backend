require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function init() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(10) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        description TEXT,
        category VARCHAR(50),
        date DATE NOT NULL,
        source VARCHAR(20),
        code TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_budgets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        budget_amount DECIMAL(12,2) NOT NULL,
        month_year VARCHAR(7) NOT NULL,
        UNIQUE(user_id, month_year)
      );
    `);
    console.log('✅ Database initialized successfully!');
  } catch (err) {
    console.error('Error initializing DB:', err);
  } finally {
    await pool.end();
  }
}

init();
