// Vercel serverless function handler

// Set NODE_ENV to production for Vercel
process.env.NODE_ENV = 'production';

// Load dotenv only if not in production (Vercel sets env vars directly)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Import the server module
const { app } = require('./server');

// Configure CORS for Vercel
const cors = require('cors');
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = ['https://ghk-tess.vercel.app', 'http://localhost:5173'];
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With', 'Accept', 'Accept-Version', 'Content-Length', 'Content-MD5', 'Date', 'X-Api-Version']
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle OPTIONS requests explicitly
app.options('*', cors(corsOptions));

// Add CORS debug endpoint
app.get('/api/cors-debug', (req, res) => {
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
app.get('/', (req, res) => {
  res.json({
    message: 'GHK Tess API Server',
    status: 'running',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Add API status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    message: 'API is running',
    status: 'ok',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Add debug endpoint
app.get('/api/cors-debug', (req, res) => {
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

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`Vercel request: ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  next();
});

// Import database functions
const { executeQuery } = require('./config/databaseConfig');

// Add database test endpoint with better error handling
app.get('/api/db-test', async (req, res) => {
  try {
    console.log('Database test endpoint called');
    console.log('Environment variables:', {
      DB_HOST: process.env.DB_HOST ? 'Set (hidden)' : 'Not set',
      DB_USER: process.env.DB_USER ? 'Set (hidden)' : 'Not set',
      DB_PASSWORD: process.env.DB_PASSWORD ? 'Set (hidden)' : 'Not set',
      DB_NAME: process.env.DB_NAME ? 'Set (hidden)' : 'Not set',
      DB_PORT: process.env.DB_PORT || '3306',
      DB_SSL: process.env.DB_SSL || 'false',
      NODE_ENV: process.env.NODE_ENV
    });

    // Periksa apakah variabel lingkungan database sudah diatur
    const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    // Uji koneksi database dengan query sederhana
    console.log('Executing database query...');
    const result = await executeQuery('SELECT 1 as test');
    console.log('Query result:', result);

    // Tambahkan informasi koneksi database (jangan tampilkan password)
    const dbInfo = {
      host: process.env.DB_HOST ? `${process.env.DB_HOST.substring(0, 4)}...` : 'Not set',
      database: process.env.DB_NAME || 'Not set',
      user: process.env.DB_USER ? `${process.env.DB_USER.substring(0, 2)}...` : 'Not set',
      port: process.env.DB_PORT || '3306',
      ssl: process.env.DB_SSL === 'true' ? 'enabled' : 'disabled'
    };

    res.json({
      success: true,
      message: 'Koneksi database berhasil',
      data: result,
      connection: dbInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error testing database:', error);

    // Kirim respons error yang lebih informatif
    res.status(500).json({
      success: false,
      message: 'Koneksi database gagal',
      error: error.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// Add simple database connection test endpoint
app.get('/api/db-connection', (req, res) => {
  // Tampilkan informasi koneksi database (jangan tampilkan password)
  const dbInfo = {
    host: process.env.DB_HOST ? `${process.env.DB_HOST.substring(0, 4)}...` : 'Not set',
    database: process.env.DB_NAME || 'Not set',
    user: process.env.DB_USER ? `${process.env.DB_USER.substring(0, 2)}...` : 'Not set',
    port: process.env.DB_PORT || '3306',
    ssl: process.env.DB_SSL === 'true' ? 'enabled' : 'disabled',
    redis_enabled: process.env.REDIS_ENABLED || 'true'
  };

  res.json({
    message: 'Database connection info',
    connection: dbInfo,
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Export the app for Vercel
module.exports = app;