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
const rateLimiterMiddleware = require('./utils/rateLimiter');
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

// Environment variables
const isProduction = process.env.NODE_ENV === 'production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const PORT = process.env.PORT || 5000;

// Rate limiting setup
const createRateLimiter = (windowMs, max) => rateLimit({
  windowMs: windowMs,
  max: isProduction ? max : 1000,
  message: 'Terlalu banyak permintaan, silakan coba lagi nanti.'
});

const authLimiter = createRateLimiter(15 * 60 * 1000, 100);
const globalLimiter = createRateLimiter(15 * 60 * 1000, 1000);

// Basic middleware
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(morgan('dev'));

const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:5173'
    ];

    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.warn('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
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

// Rate limiter in production
if (isProduction) {
  app.use(globalLimiter);
}

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

// Production middleware helper
const applyProductionMiddleware = (middleware) => (req, res, next) => {
  if (isProduction) {
    return middleware(req, res, next);
  }
  next();
};

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
  applyProductionMiddleware(authLimiter),
  applyProductionMiddleware(rateLimiterMiddleware),
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
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working' });
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

// PERBAIKAN 3: Tambahkan middleware untuk debugging routes
app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
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
