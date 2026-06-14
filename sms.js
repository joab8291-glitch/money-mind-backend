const express = require('express');
const { authenticateToken } = require('./auth');
const { Pool } = require('pg');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

// Improved SMS Parser (Server-side)
function parseMpesaSMS(text) {
  const results = [];
  const msgs = text.split(/\n{2,}|\n(?=Q[A-Z0-9]{8})/);

  msgs.forEach(msg => {
    msg = msg.trim();
    if (msg.length < 30) return;

    const codeMatch = msg.match(/\b([A-Z0-9]{8,12})\b/);
    const code = codeMatch ? codeMatch[1] : null;

    const dateMatch = msg.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    const date = dateMatch ? parseDate(dateMatch[1]) : new Date().toISOString().split('T')[0];

    const amtMatch = msg.match(/[Kk][Ss][Hh]\.?\s*([\d,]+(?:\.\d{1,2})?)/);
    const amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) : null;
    if (!amount) return;

    const lc = msg.toLowerCase();
    let type = 'expense', cat = 'Other', desc = 'M-PESA Transaction';

    if (lc.includes('received') || lc.includes('reversal') || lc.includes('deposited')) {
      type = 'income';
      desc = lc.includes('from') ? `Received from ${extractName(msg)}` : 'M-PESA received';
      cat = 'Other';
    } else if (lc.includes('sent to') || lc.includes('you sent')) {
      desc = `Sent to ${extractName(msg)}`;
    } else if (lc.includes('paybill') || lc.includes('account number')) {
      cat = 'Utilities';
      desc = 'Paybill Payment';
    } else if (lc.includes('till') || lc.includes('buy goods') || lc.includes('lipa na')) {
      cat = 'Shopping';
      desc = 'Lipa na M-PESA';
    } else if (lc.includes('airtime')) {
      cat = 'Airtime';
      desc = 'Airtime Purchase';
    } else if (lc.includes('withdrawn')) {
      desc = 'Cash Withdrawal';
    }

    const uid = `${code || 'no-code'}_${amount}_${date}`;
    
    results.push({
      type, amount, category: cat, description: desc,
      date, source: 'mpesa', code, uid
    });
  });
  return results;
}

function parseAirtelSMS(text) {
  // Similar improved parser for Airtel
  const results = [];
  const msgs = text.split(/\n{2,}/);

  msgs.forEach(msg => {
    msg = msg.trim();
    if (msg.length < 30) return;

    const codeMatch = msg.match(/Txn\s*ID[:\s]*([A-Z0-9]+)/i);
    const code = codeMatch ? codeMatch[1] : null;

    const dateMatch = msg.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
    const date = dateMatch ? parseDate(dateMatch[1]) : new Date().toISOString().split('T')[0];

    const amtMatch = msg.match(/KES\s*([\d,]+(?:\.\d{1,2})?)/i);
    const amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) : null;
    if (!amount) return;

    const lc = msg.toLowerCase();
    let type = 'expense', cat = 'Other', desc = 'Airtel Money Transaction';

    if (lc.includes('received')) {
      type = 'income';
      desc = `Received from ${extractName(msg)}`;
    } else if (lc.includes('sent')) {
      desc = `Sent to ${extractName(msg)}`;
    } else if (lc.includes('payment') || lc.includes('paid to')) {
      cat = 'Shopping';
      desc = 'Merchant Payment';
    } else if (lc.includes('airtime')) {
      cat = 'Airtime';
      desc = 'Airtime Purchase';
    } else if (lc.includes('withdrawal')) {
      desc = 'Cash Withdrawal';
    }

    const uid = `airtel_${code || 'no'}_${amount}_${date}`;
    
    results.push({
      type, amount, category: cat, description: desc,
      date, source: 'airtel', code, uid
    });
  });
  return results;
}

function parseDate(str) {
  const parts = str.split(/[\/\-]/);
  if (parts.length !== 3) return new Date().toISOString().split('T')[0];
  let [d, m, y] = parts.map(Number);
  if (y < 100) y += 2000;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extractName(msg) {
  const match = msg.match(/(?:from|to|sent to)\s+([A-Z\s]+)/i);
  return match ? match[1].trim() : 'Unknown';
}

// Parse SMS endpoint
router.post('/parse', authenticateToken, async (req, res) => {
  const { text, provider } = req.body;

  if (!text || !provider) {
    return res.status(400).json({ error: 'Text and provider required' });
  }

  const parsed = provider === 'mpesa' ? parseMpesaSMS(text) : parseAirtelSMS(text);
  
  let imported = 0;
  const skipped = [];

  for (const tx of parsed) {
    try {
      await pool.query(
        `INSERT INTO transactions (user_id, type, amount, description, category, date, source, code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [req.user.userId, tx.type, tx.amount, tx.description, tx.category, tx.date, tx.source, tx.code]
      );
      imported++;
    } catch (e) {
      // Likely duplicate
      skipped.push(tx.description);
    }
  }

  res.json({
    imported,
    skipped: skipped.length,
    message: `${imported} transactions imported successfully`
  });
});

module.exports = router;
