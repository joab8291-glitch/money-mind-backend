# MoneyMind Backend

## Setup
1. `npm install`
2. Set environment variables (DATABASE_URL, JWT_SECRET)
3. `npm run init-db`
4. `npm start`

## Deploy on Render
- Create PostgreSQL Database
- Create Web Service with this repo
- Add Environment Variables:
  - DATABASE_URL
  - JWT_SECRET (long random string)
  - NODE_ENV=production
