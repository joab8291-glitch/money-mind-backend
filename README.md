# MoneyMind Backend

Production-ready Node.js + PostgreSQL backend for the Kenyan budget tracker.

## Features
- User registration & login (JWT)
- Transaction CRUD
- Advanced SMS parsing for M-PESA & Airtel Money
- Monthly budget management
- Secure & scalable

## Setup

1. Copy `.env.example` to `.env` and fill in values
2. Run `npm install`
3. `npm run init-db`
4. `npm run dev`

## Deploy to Render.com
- Create new Web Service
- Connect your GitHub repo (after pushing)
- Set environment variables (DATABASE_URL from PostgreSQL addon)

## Frontend Connection
Update the frontend to call:
- `https://your-backend.onrender.com/api/...`

Built for Kenya 🇰🇪
