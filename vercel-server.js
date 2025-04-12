// Vercel serverless function handler
const app = require('./server').app;

// Export for Vercel
module.exports = app;
