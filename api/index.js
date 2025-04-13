// Vercel serverless entry point
const serverless = require('serverless-http');
const app = require('../vercel-server');

// Export the Express app wrapped with serverless-http
module.exports = serverless(app);
