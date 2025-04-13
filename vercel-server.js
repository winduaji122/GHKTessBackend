// Vercel serverless function handler

// Set NODE_ENV to production for Vercel
process.env.NODE_ENV = 'production';

// Load dotenv only if not in production (Vercel sets env vars directly)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Wrap in try-catch to catch any initialization errors
try {
  // Import the Express app
  const app = require('./server').app;

  // Add CORS middleware for Vercel
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://ghk-tess.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    next();
  });

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

  // Add error handler for uncaught errors
  app.use((err, _, res, __) => {
    console.error('Unhandled error in serverless function:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
    });
  });

  // Export for Vercel
  module.exports = app;
} catch (error) {
  console.error('Fatal error during serverless function initialization:', error);

  // Create a minimal express app to handle requests when main app fails to initialize
  const express = require('express');
  const fallbackApp = express();

  fallbackApp.all('*', (_, res) => {
    res.status(500).json({
      error: 'Server Initialization Error',
      message: process.env.NODE_ENV === 'production' ? 'Server failed to initialize' : error.message
    });
  });

  module.exports = fallbackApp;
}

