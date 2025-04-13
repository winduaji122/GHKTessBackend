// Vercel serverless function handler

// Set NODE_ENV to production for Vercel
process.env.NODE_ENV = 'production';

// Load dotenv only if not in production (Vercel sets env vars directly)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Create a new Express app for Vercel
const express = require('express');
const cors = require('cors');
const vercelApp = express();

// Configure CORS for Vercel
const corsOptions = {
  origin: ['https://ghk-tess.vercel.app', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With', 'Accept', 'Accept-Version', 'Content-Length', 'Content-MD5', 'Date', 'X-Api-Version']
};

// Apply CORS middleware
vercelApp.use(cors(corsOptions));

// Handle OPTIONS requests explicitly
vercelApp.options('*', cors(corsOptions));

// Wrap in try-catch to catch any initialization errors
try {
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

  // Add error handler for uncaught errors
  app.use((err, _, res, __) => {
    console.error('Unhandled error in serverless function:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
    });
  });

  // Add root route handler
  vercelApp.get('/', (req, res) => {
    res.json({
      message: 'GHK Tess API Server',
      status: 'running',
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  });

  // Add API status endpoint
  vercelApp.get('/api/status', (req, res) => {
    res.json({
      message: 'API is running',
      status: 'ok',
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  });

  // Add debug endpoint
  vercelApp.get('/api/cors-debug', (req, res) => {
    res.json({
      message: 'CORS Debug Endpoint',
      headers: req.headers,
      origin: req.headers.origin,
      host: req.headers.host,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        FRONTEND_URL: process.env.FRONTEND_URL
      },
      timestamp: new Date().toISOString()
    });
  });

  // Use the original app as middleware
  vercelApp.use((req, res, next) => {
    // Log request for debugging
    console.log(`Vercel request: ${req.method} ${req.url}`);
    console.log('Headers:', req.headers);
    next();
  });

  vercelApp.use(app);

  // Export the Vercel app
  module.exports = vercelApp;
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

  module.exports = vercelApp;
}

