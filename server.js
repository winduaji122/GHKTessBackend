// Core modules
const path = require('path');
const fs = require('fs');

// Load environment variables based on NODE_ENV
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.join(__dirname, envFile);

// Check if env file exists
if (fs.existsSync(envPath)) {
  console.log(`Loading environment from ${envFile}`);
  require('dotenv').config({ path: envPath });
} else {
  console.log(`${envFile} not found, loading default .env`);
  require('dotenv').config();
}

// Third-party modules
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const expressStaticGzip = require('express-static-gzip');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const jwt = require('jsonwebtoken');
const session = require('express-session');

// Local modules
const { sendEmail } = require('./utils/emailService');
const { verifyToken, isAuthenticated } = require('./middleware/authMiddleware');
const { redis, pool, executeQuery } = require('./config/databaseConfig');
// Rate limiter diimplementasikan di utils/rateLimiter.js dan digunakan di routes
const { logger } = require('./utils/logger');
const { AppError, handleError } = require('./utils/errorHandler');
const User = require('./models/User');
const { checkUploadPermissions } = require('./utils/checkPermissions');
const { upload, uploadDir } = require('./uploadConfig');
const { startCleanupSchedule } = require('./utils/tokenCleanup');

// Route imports
const authRoutes = require('./routes/authRoutes');
const labelsRouter = require('./routes/labels');
const postsRouter = require('./routes/posts');
const searchRoutes = require('./routes/search');
const uploadRoutes = require('./routes/uploadRoutes');
const carouselRoutes = require('./routes/carouselRoutes');

const app = express();

// Enable trust proxy for Vercel environment
app.set('trust proxy', 1);
console.log('Trust proxy enabled for Express');

// Environment variables
const isProduction = process.env.NODE_ENV === 'production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const PORT = process.env.PORT || 5000;

// CATATAN: Rate limiter telah dipindahkan ke utils/rateLimiter.js
// Tidak menggunakan rate limiter global untuk menghindari tumpang tindih

// Basic middleware
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(morgan('dev'));

const corsOptions = {
  origin: (origin, callback) => {
    // Daftar origin yang diizinkan
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'https://ghk-tess.vercel.app',
      'http://localhost:5173'
    ];

    // Log untuk debugging
    logger.info('CORS Request:', {
      service: 'user-service',
      origin,
      method: 'PREFLIGHT',
      path: 'CORS Check'
    });

    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Izinkan semua origin di development
    if (process.env.NODE_ENV !== 'production') {
      callback(null, true);
      return;
    }

    // Periksa apakah origin ada dalam daftar yang diizinkan
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('Blocked by CORS:', origin);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-CSRF-Token',
    'X-XSRF-TOKEN',
    'Cache-Control',
    'If-None-Match',
    'If-Modified-Since',
    'Pragma'
  ],
  exposedHeaders: [
    'Set-Cookie',
    'X-CSRF-Token',
    'Authorization'
  ],
  maxAge: 86400, // 24 hours in seconds
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "http://localhost:5000", process.env.FRONTEND_URL],
      connectSrc: ["'self'",
        "http://localhost:5000",  // Tambahkan backend URL
        process.env.FRONTEND_URL,
        "ws://localhost:*"  // Untuk WebSocket jika digunakan
      ],
      frameSrc: ["'self'", process.env.FRONTEND_URL]
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
}));

app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));


app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
  } else {
    logger.info('CORS Request:', {
      origin: req.headers.origin,
      method: req.method,
      path: req.path,
      cookies: req.cookies ? 'Present' : 'Not present'
    });
    next();
  }
});

// Rate limiter sekarang diimplementasikan di utils/rateLimiter.js dan digunakan di routes

// Cookie configuration yang konsisten
const COOKIE_CONFIG = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  domain: process.env.COOKIE_DOMAIN || undefined,
  path: '/',
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
};

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    // Log preflight requests
    logger.info('Preflight request:', {
      origin: req.headers.origin,
      method: req.method,
      path: req.path
    });

    res.header('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return;
  }
  next();
});

// CSRF protection dengan config yang konsisten
const csrfProtection = csrf({
  cookie: {
    key: '_csrf',
    ...COOKIE_CONFIG,
    maxAge: 3600 // 1 jam
  }
});

// Cookie monitoring middleware
app.use((req, res, next) => {
  const oldSetCookie = res.setHeader.bind(res);
  res.setHeader = function(name, value) {
    if (name === 'Set-Cookie') {
      logger.info('Setting cookie:', {
        value: Array.isArray(value) ? value.map(v => v.split(';')[0]) : value.split(';')[0],
        path: req.path,
        origin: req.headers.origin
      });
    }
    return oldSetCookie(name, value);
  };
  next();
});

// Static files setup
const uploadsPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

// Buat direktori uploads/profiles jika belum ada
const profilesPath = path.join(uploadsPath, 'profiles');
if (!fs.existsSync(profilesPath)) {
  fs.mkdirSync(profilesPath, { recursive: true });
}

// Tambahkan alias /storage/ yang mengarah ke direktori uploads
app.use('/storage', expressStaticGzip(uploadsPath, {
  enableBrotli: true,
  orderPreference: ['br', 'gz'],
  serveStatic: {
    maxAge: '1d', // Konsisten 1 hari
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
      // Konsisten cache control
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
      res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      // Tambahkan header untuk debugging
      res.setHeader('X-Served-By', 'expressStaticGzip');

      // Disable cache untuk file yang tidak ditemukan
      if (!fs.existsSync(path)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    }
  }
}));

// Konfigurasi untuk direktori /uploads/
app.use('/uploads', expressStaticGzip(uploadsPath, {
  enableBrotli: true,
  orderPreference: ['br', 'gz'],
  serveStatic: {
    maxAge: '1d', // Konsisten 1 hari
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
      // Konsisten cache control
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
      res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      // Tambahkan header untuk debugging
      res.setHeader('X-Served-By', 'expressStaticGzip-uploads');

      // Disable cache untuk file yang tidak ditemukan
      if (!fs.existsSync(path)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    }
  }
}));

app.use('/uploads', (req, res, next) => {
  const filePath = path.join(uploadsPath, req.path);
  logger.info('Accessing upload file:', {
    path: req.path,
    fullPath: filePath,
    exists: fs.existsSync(filePath),
    method: req.method,
    headers: req.headers
  });
  next();
});

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Production middleware helper (tidak digunakan lagi)
// Rate limiter sekarang diimplementasikan di utils/rateLimiter.js dan digunakan di routes

// Route untuk mengecek keberadaan file
app.get('/api/check-file/:filename', (req, res) => {
  const filePath = path.join(uploadsPath, req.params.filename);
  const exists = fs.existsSync(filePath);

  logger.info('File check:', {
    filename: req.params.filename,
    path: filePath,
    exists: exists
  });

  if (exists) {
    const stats = fs.statSync(filePath);
    res.json({
      exists: true,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      permissions: stats.mode
    });
  } else {
    res.status(404).json({
      exists: false,
      message: 'File not found'
    });
  }
});

// API Routes
app.use('/api/auth',
  // Tidak menggunakan rate limiter global di sini, karena sudah ada di authRoutes.js
  (req, res, next) => {
    // Log auth requests
    logger.info('Auth request:', {
      path: req.path,
      method: req.method,
      cookies: !!req.cookies,
      headers: {
        origin: req.headers.origin,
        authorization: !!req.headers.authorization
      }
    });
    next();
  },
  authRoutes
);

// Tambahkan route khusus untuk debug CORS
app.get('/api/debug/cors', (req, res) => {
  res.json({
    headers: req.headers,
    cookies: req.cookies,
    origin: req.headers.origin,
    method: req.method
  });
});

app.use('/api/labels',
  applyProductionMiddleware(authLimiter),
  verifyToken,
  labelsRouter
);

app.use('/api/search', searchRoutes);

app.use('/api/posts',
  (req, res, next) => {
    logger.info('Posts route accessed:', {
      method: req.method,
      path: req.path,
      params: req.params,
      user: req.user?.id
    });
    next();
  },
  postsRouter
);

app.use('/api/upload', uploadRoutes);

app.use('/api/carousel', carouselRoutes);

// Utility routes
// Endpoint CSRF token dihapus dari server.js dan dikonsolidasikan ke authRoutes.js

app.get('/api/test', (req, res) => {
  res.json({
    message: 'Server is working',
    environment: process.env.NODE_ENV,
    frontend_url: process.env.FRONTEND_URL,
    base_url: process.env.BASE_URL,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/check-cookies', (req, res) => {
  logger.info('Checking cookies:', {
    cookies: req.cookies,
    signedCookies: req.signedCookies,
    headers: req.headers
  });

  res.json({
    cookies: req.cookies,
    signedCookies: req.signedCookies,
    headers: {
      origin: req.headers.origin,
      referer: req.headers.referer
    }
  });
});

app.get('/test-email', async (req, res) => {
  try {
    const result = await sendEmail(
      'doryaji999@gmail.com',
      'Test Email from Your App',
      'Test Email from Gema Hati Kudus',
      '<h1>Test Email</h1><p>This is a test email sent from your application.</p>'
    );
    res.status(result ? 200 : 500).send(result ? 'Test email sent successfully' : 'Failed to send test email');
  } catch (error) {
    logger.error('Error sending test email:', error);
    res.status(500).send('Error sending test email');
  }
});

// Protected routes
app.get('/api/protected', verifyToken, (req, res) => {
  res.json({ message: 'Ini adalah rute yang dilindungi', user: req.user });
});

// Perbaiki route upload
app.post('/api/upload',
  verifyToken,
  async (req, res, next) => {
    try {
      // Validasi permission
      if (!await checkUploadPermissions()) {
        throw new AppError('Upload directory not accessible', 500);
      }
      next();
    } catch (error) {
      next(error);
    }
  },
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        throw new AppError('Tidak ada file yang diupload', 400);
      }

      const filePath = path.join(uploadDir, req.file.filename);

      // Verifikasi file tersimpan
      if (!await fileExists(filePath)) {
        throw new AppError('Gagal menyimpan file', 500);
      }

      logger.info('File upload success:', {
        filename: req.file.filename,
        path: filePath,
        size: req.file.size,
        mimetype: req.file.mimetype,
        user: req.user?.id
      });

      res.json({
        success: true,
        message: 'File berhasil diupload',
        data: {
          filename: req.file.filename,
          path: `/uploads/${req.file.filename}`,
          size: req.file.size,
          type: req.file.mimetype
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// Additional logging middleware
app.use((req, res, next) => {
  if ((req.path === '/api/auth/login' && req.method === 'POST') ||
      (req.path.startsWith('/api/posts/') && req.method === 'PUT')) {
    logger.info(`${req.method} ${req.path} request:`, { body: req.body, file: req.file });
  }
  next();
});

app.use((req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode === 401 || res.statusCode === 403) {
      logger.warn(`Failed authentication attempt: ${req.method} ${req.originalUrl}`);
    }
  });
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Error details:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    headers: {
      origin: req.headers.origin,
      referer: req.headers.referer
    }
  });

  // Error mapping untuk berbagai tipe error
  const errorMap = {
    TokenExpiredError: {
      message: 'Token telah kadaluarsa',
      code: 'TOKEN_EXPIRED',
      status: 401
    },
    JsonWebTokenError: {
      message: 'Token tidak valid',
      code: 'INVALID_TOKEN',
      status: 401
    },
    TokenRefreshError: {
      message: 'Gagal memperbarui token, silakan login kembali',
      code: 'REFRESH_FAILED',
      status: 401
    },
    EBADCSRFTOKEN: {
      message: 'Invalid CSRF token, silakan refresh halaman',
      code: 'INVALID_CSRF',
      status: 403
    },
    MulterError: {
      LIMIT_FILE_SIZE: {
        message: 'File terlalu besar. Maksimum 5MB',
        code: 'FILE_TOO_LARGE',
        status: 400
      },
      default: {
        message: 'Error saat upload file',
        code: 'UPLOAD_ERROR',
        status: 400
      }
    },
    // Tambahkan penanganan error untuk koneksi database
    ER_USER_LIMIT_REACHED: {
      message: 'Terlalu banyak koneksi database, coba lagi nanti',
      code: 'DB_CONNECTION_LIMIT',
      status: 503
    },
    ECONNREFUSED: {
      message: 'Tidak dapat terhubung ke database, coba lagi nanti',
      code: 'DB_CONNECTION_REFUSED',
      status: 503
    },
    ETIMEDOUT: {
      message: 'Koneksi database timeout, coba lagi nanti',
      code: 'DB_CONNECTION_TIMEOUT',
      status: 503
    },
    PROTOCOL_CONNECTION_LOST: {
      message: 'Koneksi database terputus, coba lagi nanti',
      code: 'DB_CONNECTION_LOST',
      status: 503
    }
  };

  // Handle specific errors
  if (err instanceof AppError) {
    return handleError(err, req, res);
  }

  // Handle Multer errors
  if (err.name === 'MulterError') {
    const multerError = errorMap.MulterError[err.code] || errorMap.MulterError.default;
    return res.status(multerError.status).json({
      success: false,
      ...multerError
    });
  }

  // Handle mapped errors
  const mappedError = errorMap[err.name || err.code];
  if (mappedError) {
    return res.status(mappedError.status).json({
      success: false,
      ...mappedError
    });
  }

  // Default error
  return res.status(500).json({
    success: false,
    message: 'Terjadi kesalahan internal server',
    code: 'SERVER_ERROR'
  });
});

// Graceful shutdown function
const gracefulShutdown = async (server) => {
  logger.info('Received shutdown signal');

  // Berhenti menerima koneksi baru
  server.close(async () => {
    logger.info('Server stopped accepting new connections');

    try {
      // Cleanup resources
      logger.info('Cleaning up resources...');

      // Close Redis connection
      if (redis) {
        await redis.quit();
        logger.info('Redis connection closed');
      }

      // Close database pool
      if (pool) {
        await pool.end();
        logger.info('Database pool closed');
      }

      // Remove temporary files
      const uploadsPath = path.join(__dirname, 'uploads/temp');
      if (fs.existsSync(uploadsPath)) {
        fs.rmdirSync(uploadsPath, { recursive: true });
        logger.info('Temporary files cleaned up');
      }

      logger.info('Cleanup completed, shutting down process');
      process.exit(0);
    } catch (error) {
      logger.error('Error during cleanup:', error);
      process.exit(1);
    }
  });

  // Force shutdown after timeout
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000); // 10 seconds
};

// Server startup with enhanced error handling
async function startServer() {
  try {
    // Test database connection
    await executeQuery(async (connection) => {
      await connection.query('SELECT 1');
    });
    logger.info('Database connection successful');

    // Cek permission uploads folder
    const permissionsOk = await checkUploadPermissions();
    if (!permissionsOk) {
      logger.error('Upload directory permissions not correct - please fix!');
      // Optional: process.exit(1);
    }

    // Start server
    const server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      if (!isProduction) {
        console.log('Available routes:');
        app._router.stack.forEach(r => {
          if (r.route && r.route.path) {
            console.log(`${Object.keys(r.route.methods)} ${r.route.path}`);
          }
        });
      }

      // Mulai cleanup token setiap 2 jam
      startCleanupSchedule(2 * 60 * 60 * 1000);
    });

    // Setup shutdown handlers
    const shutdownHandler = () => gracefulShutdown(server);
    process.on('SIGTERM', shutdownHandler);
    process.on('SIGINT', shutdownHandler);

    return server;
  } catch (error) {
    logger.error('Failed to start server:', error);
    throw new AppError('Failed to start server', 500);
  }
}

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', {
    reason: reason instanceof Error ? reason.stack : reason,
    promise: promise
  });
  // Tidak langsung exit, biarkan graceful shutdown handle
  process.emit('SIGTERM');
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', {
    error: error.stack
  });
  // Tidak langsung exit, biarkan graceful shutdown handle
  process.emit('SIGTERM');
});

// Tambahkan middleware untuk debugging routes
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`, { service: 'http-service' });
  next();
});

// Tambahkan endpoint fallback untuk menangani error koneksi database
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '1.0.0'
  });
});

// Tambahkan endpoint fallback untuk data posts jika database tidak tersedia
app.get('/api/posts/fallback', (req, res) => {
  res.json({
    success: true,
    message: 'Fallback data returned due to database connection issues',
    data: [],
    pagination: {
      currentPage: 1,
      totalPages: 0,
      totalItems: 0,
      limit: 10
    }
  });
});

// Add database connection test endpoint
app.get('/api/db-connection', (req, res) => {
  // Tampilkan informasi koneksi database (jangan tampilkan password)
  const dbInfo = {
    host: process.env.DB_HOST ? `${process.env.DB_HOST.substring(0, 4)}...` : 'Not set',
    database: process.env.DB_NAME || 'Not set',
    user: process.env.DB_USER ? `${process.env.DB_USER.substring(0, 2)}...` : 'Not set',
    port: process.env.DB_PORT || '3306',
    ssl: process.env.DB_SSL === 'true' ? 'enabled' : 'disabled',
    redis_enabled: process.env.REDIS_ENABLED || 'true',
    vercel: process.env.VERCEL || 'Not set'
  };

  res.json({
    message: 'Database connection info',
    connection: dbInfo,
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Add database test endpoint
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

// PERBAIKAN 4: Log semua routes yang terdaftar saat server startup
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Log semua routes yang terdaftar
  console.log('Registered routes:');
  const routes = [];

  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      // Routes registered directly on the app
      const methods = Object.keys(middleware.route.methods)
        .filter(method => middleware.route.methods[method])
        .join(', ').toUpperCase();
      routes.push(`${methods} ${middleware.route.path}`);
    } else if (middleware.name === 'router') {
      // Router middleware
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          const methods = Object.keys(handler.route.methods)
            .filter(method => handler.route.methods[method])
            .join(', ').toUpperCase();
          let path = handler.route.path;
          if (middleware.regexp) {
            // Extract the base path from the router
            const match = middleware.regexp.toString().match(/^\/\^\\\/([^\\]+)/);
            if (match) {
              path = '/' + match[1] + path;
            }
          }
          routes.push(`${methods} ${path}`);
        }
      });
    }
  });

  routes.forEach(route => console.log(route));
});

module.exports = { app, startServer };
