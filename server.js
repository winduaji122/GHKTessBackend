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
const { cleanupPort } = require('./utils/portChecker');

// Route imports
const authRoutes = require('./routes/authRoutes');
const labelsRouter = require('./routes/labels');
const postsRouter = require('./routes/posts');
const searchRoutes = require('./routes/search');
const uploadRoutes = require('./routes/uploadRoutes');
const carouselRoutes = require('./routes/carouselRoutes');
const carouselPostRoutes = require('./routes/carouselPostRoutes');
const commentsRouter = require('./routes/comments');
const likesRouter = require('./routes/likes');
const dashboardRouter = require('./routes/dashboard');
const staticPagesRouter = require('./routes/staticPages');

const app = express();

// Enable trust proxy for Vercel/Railway environment
app.set('trust proxy', 1);
console.log('Trust proxy enabled for Express');

// Detect Railway environment
const isRailway = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_SERVICE_ID;
if (isRailway) {
  console.log('Railway environment detected');
}

// Environment variables
const isProduction = process.env.NODE_ENV === 'production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Pastikan port selalu konsisten untuk produksi lokal
let PORT = process.env.PORT || 5000;
if (isProduction && PORT === '0') {
  PORT = 5000;
  console.log('Warning: PORT=0 detected in production mode. Using default port 5000 instead.');
}

// Log konfigurasi port
console.log(`API Base URL being used: http://localhost:${PORT}`);


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
      'http://localhost:5173',
      'https://nodejs-production-0c33.up.railway.app',
      'https://merry-reprieve-production.up.railway.app'
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
    'Pragma',
    'Expires',
    'X-Client-ID',
    'X-User-Identity',
    'X-Public-Request'
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

// Konfigurasi khusus untuk direktori /uploads/profiles/
app.use('/uploads/profiles', (req, res, next) => {
  // Log akses ke file profil
  const filePath = path.join(profilesPath, req.path);
  logger.info('Profile image accessed:', {
    path: req.path,
    fullPath: filePath,
    exists: fs.existsSync(filePath),
    method: req.method,
    headers: req.headers
  });
  next();
}, express.static(profilesPath, {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Served-By', 'express-static-profiles');
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
// Tambahkan middleware untuk menangani permintaan ke /auth/refresh-token
app.get('/auth/refresh-token', (req, res) => {
  logger.info('Redirecting from /auth/refresh-token to /api/auth/refresh-token');
  // Redirect ke endpoint yang benar
  req.url = '/api/auth/refresh-token';
  app.handle(req, res);
});

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

// Middleware untuk memeriksa apakah request adalah request publik
const checkPublicRequest = (req, res, next) => {
  // Jika request memiliki header X-Public-Request, bypass verifikasi token
  if (req.headers['x-public-request'] === 'true' ||
      req.path === '/with-sublabels' ||
      req.path === '/slug' ||
      req.path.startsWith('/slug/')) {
    logger.info('Public request detected, bypassing token verification', {
      path: req.path,
      headers: req.headers['x-public-request']
    });
    return next();
  }

  // Jika bukan request publik, verifikasi token
  verifyToken(req, res, next);
};

app.use('/api/labels',
  // Rate limiter dihapus untuk menghindari tumpang tindih
  checkPublicRequest,
  labelsRouter
);

app.use('/api/search', searchRoutes);

// Middleware untuk memeriksa apakah request posts adalah request publik
const checkPostsPublicRequest = (req, res, next) => {
  // Jika request memiliki header X-Public-Request, bypass verifikasi token
  if (req.headers['x-public-request'] === 'true' ||
      req.path.startsWith('/public/') ||
      req.path.startsWith('/label/') ||
      req.path.startsWith('/by-label-id/') ||
      req.path.startsWith('/by-label-slug/') ||
      req.path === '/' ||
      req.path === '/featured' ||
      req.path === '/spotlight' ||
      req.path === '/popular') {
    logger.info('Public posts request detected, bypassing token verification', {
      path: req.path,
      headers: req.headers['x-public-request']
    });
    return next();
  }

  // Jika bukan request publik, verifikasi token
  verifyToken(req, res, next);
};

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
  checkPostsPublicRequest,
  postsRouter
);

app.use('/api/upload', uploadRoutes);

app.use('/api/carousel', carouselRoutes);
app.use('/api/carousel-post', carouselPostRoutes);

// Comments and Likes routes
app.use('/api/comments', commentsRouter);
app.use('/api/likes', likesRouter);

// Dashboard route
app.use('/api/dashboard', dashboardRouter);

// Static Pages route
app.use('/api/static-pages', staticPagesRouter);

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

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Error details:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.method === 'POST' || req.method === 'PUT' ? req.body : undefined
  });

  // Jika error adalah AppError, gunakan status code dan pesan yang sudah ditentukan
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      error: err.name,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
    });
  }

  // Jika error adalah CSRF, berikan pesan yang lebih jelas
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      success: false,
      message: 'Invalid CSRF token. Silakan refresh halaman dan coba lagi.',
      error: 'CSRF Error'
    });
  }

  // Jika error adalah ValidationError dari express-validator, berikan pesan yang lebih jelas
  if (err.array && typeof err.array === 'function') {
    const validationErrors = err.array();
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: validationErrors
    });
  }

  // Jika error adalah SyntaxError dari JSON parsing, berikan pesan yang lebih jelas
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON',
      error: 'SyntaxError',
      details: err.message
    });
  }

  // Jika error adalah MulterError, berikan pesan yang lebih jelas
  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`,
      error: err.name,
      code: err.code
    });
  }

  // Jika error adalah JsonWebTokenError, berikan pesan yang lebih jelas
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token. Please login again.',
      error: err.name
    });
  }

  // Default error response
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: err.name || 'Error',
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
});

// Tambahkan middleware untuk debugging routes
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`, { service: 'http-service' });
  next();
});

// Tambahkan route untuk path root
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to GHK Tess API',
    version: '1.0.0',
    documentation: '/api/docs',
    health: '/api/health',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Tambahkan route untuk dokumentasi API
app.get('/api/docs', (req, res) => {
  res.json({
    api_version: '1.0.0',
    base_url: process.env.BASE_URL || `http://localhost:${PORT}`,
    endpoints: {
      auth: {
        login: 'POST /api/auth/login',
        register: 'POST /api/auth/register',
        refresh_token: 'GET /api/auth/refresh-token',
        logout: 'POST /api/auth/logout'
      },
      posts: {
        list: 'GET /api/posts',
        get_by_id: 'GET /api/posts/:id',
        create: 'POST /api/posts',
        update: 'PUT /api/posts/:id',
        delete: 'DELETE /api/posts/:id',
        get_by_slug: 'GET /api/posts/public/slug/:slug'
      },
      labels: {
        list: 'GET /api/labels',
        get_by_id: 'GET /api/labels/:id',
        create: 'POST /api/labels',
        update: 'PUT /api/labels/:id',
        delete: 'DELETE /api/labels/:id'
      },
      utility: {
        health: 'GET /api/health',
        db_connection: 'GET /api/db-connection',
        db_test: 'GET /api/db-test'
      }
    }
  });
});

// Tambahkan endpoint fallback untuk menangani error koneksi database
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Endpoint untuk mendiagnosis masalah koneksi database
app.get('/api/db-diagnostics', (req, res) => {
  // Hanya tampilkan informasi penting tanpa password
  const diagnostics = {
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      RAILWAY_SERVICE_ID: process.env.RAILWAY_SERVICE_ID ? 'SET' : 'NOT SET',
      RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID ? 'SET' : 'NOT SET',
      RAILWAY_ENVIRONMENT_ID: process.env.RAILWAY_ENVIRONMENT_ID ? 'SET' : 'NOT SET'
    },
    database: {
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD ? 'SET' : 'NOT SET',
      DB_NAME: process.env.DB_NAME,
      DB_SSL: process.env.DB_SSL
    },
    railway_mysql: {
      MYSQLHOST: process.env.MYSQLHOST,
      MYSQLPORT: process.env.MYSQLPORT,
      MYSQLUSER: process.env.MYSQLUSER,
      MYSQLPASSWORD: process.env.MYSQLPASSWORD ? 'SET' : 'NOT SET',
      MYSQLDATABASE: process.env.MYSQLDATABASE,
      MYSQL_ROOT_PASSWORD: process.env.MYSQL_ROOT_PASSWORD ? 'SET' : 'NOT SET',
      MYSQL_DATABASE: process.env.MYSQL_DATABASE
    },
    railway_tcp_proxy: {
      RAILWAY_TCP_PROXY_DOMAIN: process.env.RAILWAY_TCP_PROXY_DOMAIN,
      RAILWAY_TCP_PROXY_PORT: process.env.RAILWAY_TCP_PROXY_PORT,
      RAILWAY_TCP_APPLICATION_PORT: process.env.RAILWAY_TCP_APPLICATION_PORT
    }
  };

  res.json(diagnostics);
});

// Tambahkan endpoint fallback untuk data posts jika database tidak tersedia
app.get('/api/posts/fallback', (req, res) => {
  res.json({
    success: true,
    message: 'Fallback data returned due to database connection issues',
    posts: [
      {
        id: 'fallback-1',
        title: 'Artikel Sementara',
        content: 'Konten artikel sementara. Silakan coba lagi nanti.',
        status: 'published',
        created_at: new Date().toISOString(),
        author: 'System'
      }
    ]
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
    ssl: process.env.DB_SSL === 'true' ? 'enabled' : 'disabled'
  };

  res.json({
    success: true,
    message: 'Database connection info',
    connection: dbInfo,
    timestamp: new Date().toISOString()
  });
});

// Add database test endpoint
app.get('/api/db-test', async (req, res) => {
  try {
    console.log('Database test endpoint called');
    console.log('Environment variables:', {
      DB_HOST: process.env.DB_HOST ? `${process.env.DB_HOST.substring(0, 4)}...` : 'Not set',
      DB_NAME: process.env.DB_NAME || 'Not set',
      DB_USER: process.env.DB_USER ? `${process.env.DB_USER.substring(0, 2)}...` : 'Not set',
      DB_PORT: process.env.DB_PORT || '3306',
      DB_SSL: process.env.DB_SSL
    });

    // Periksa apakah semua variabel lingkungan yang diperlukan ada
    const requiredEnvVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
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

// Add direct database connection test endpoint
app.get('/api/db-direct-test', async (req, res) => {
  const mysql = require('mysql2/promise');

  try {
    console.log('Direct database test endpoint called');

    // Hardcoded credentials for Railway
    const connectionConfig = {
      host: 'hopper.proxy.rlwy.net',
      port: 59942,
      user: 'root',
      password: 'MOOANaYOrdGrDIRNsFCfjXlsierCZXdX',
      database: 'mydatabase',
      ssl: {
        rejectUnauthorized: false
      }
    };

    console.log('Creating direct connection with config:', {
      host: connectionConfig.host,
      port: connectionConfig.port,
      user: connectionConfig.user,
      password: connectionConfig.password ? 'SET' : 'NOT SET',
      database: connectionConfig.database
    });

    // Create direct connection
    const connection = await mysql.createConnection(connectionConfig);

    // Execute test query
    const [rows] = await connection.execute('SELECT 1 as test');

    // Close connection
    await connection.end();

    res.json({
      success: true,
      message: 'Koneksi database langsung berhasil',
      result: rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Direct database test error:', error);
    res.status(500).json({
      success: false,
      message: 'Koneksi database langsung gagal',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Fungsi untuk memulai server dengan port cleanup
const startServer = async () => {
  try {
    // Log informasi database yang digunakan
    console.log('\n==== DATABASE CONNECTION INFO ====');
    console.log(`Host: ${process.env.DB_HOST}`);
    console.log(`Port: ${process.env.DB_PORT}`);
    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`User: ${process.env.DB_USER}`);
    console.log(`SSL: ${process.env.DB_SSL === 'true' ? 'Enabled' : 'Disabled'}`);
    console.log('==================================\n');

    // Coba bersihkan port jika sudah digunakan
    const portCleaned = await cleanupPort(PORT);
    if (!portCleaned) {
      logger.warn(`Port ${PORT} masih digunakan oleh proses lain. Mencoba port alternatif...`, { service: 'server-startup' });

      // Jika port tidak bisa dibersihkan, coba port alternatif
      const alternativePorts = [3000, 4000, 8000, 8080];
      let portFound = false;

      for (const altPort of alternativePorts) {
        const isAvailable = await cleanupPort(altPort);
        if (isAvailable) {
          logger.info(`Menggunakan port alternatif: ${altPort}`, { service: 'server-startup' });
          PORT = altPort;
          portFound = true;
          break;
        }
      }

      if (!portFound) {
        throw new Error(`Tidak dapat menemukan port yang tersedia. Coba hentikan proses yang menggunakan port ${PORT} secara manual.`);
      }
    }

    // Mulai server dengan port yang sudah dibersihkan
    return new Promise((resolve) => {
      const server = app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`, { service: 'user-service' });

        // Log semua routes yang terdaftar
        console.log('Available routes:');
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
        resolve(server);
      });
    });
  } catch (error) {
    logger.error(`Error starting server: ${error.message}`, { service: 'server-startup', stack: error.stack });
    throw error;
  }
};

module.exports = { app, startServer };
