// Vercel serverless function handler

// Set NODE_ENV to production for Vercel
process.env.NODE_ENV = 'production';

// Load dotenv only if not in production (Vercel sets env vars directly)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Import the Express app
const app = require('./server').app;

// Handle serverless function timeouts
const serverlessTimeout = setTimeout(() => {
  console.log('Serverless function timeout warning: Function execution time is approaching timeout');
}, 9000); // 9 seconds (Vercel has 10s timeout for hobby plan)

// Clear timeout when the request ends
app.use((_, res, next) => {
  res.on('finish', () => {
    clearTimeout(serverlessTimeout);
  });
  next();
});

// Export for Vercel
module.exports = app;
