const { RateLimiterRedis } = require('rate-limiter-flexible');
const { redis } = require('../config/databaseConfig');
const { logger } = require('./logger');

// Whitelist IP untuk pengujian dan development
const WHITELIST_IPS = [
  '127.0.0.1',
  'localhost',
  '::1',
  // Tambahkan IP Anda di sini jika diperlukan
];

// Konfigurasi rate limiter berdasarkan environment
const isProduction = process.env.NODE_ENV === 'production';
const RATE_LIMIT_CONFIG = {
  // Konfigurasi untuk production
  production: {
    general: {
      points: 1000,      // 1000 permintaan
      duration: 60 * 10, // per 10 menit
      blockDuration: 60  // blokir 1 menit jika melebihi
    },
    csrf: {
      points: 500,       // 500 permintaan
      duration: 60 * 10,  // per 10 menit
      blockDuration: 30   // blokir 30 detik jika melebihi
    },
    auth: {
      points: 100,       // 100 permintaan
      duration: 60 * 10,  // per 10 menit
      blockDuration: 60   // blokir 1 menit jika melebihi
    }
  },
  // Konfigurasi untuk development (lebih longgar)
  development: {
    general: {
      points: 10000,     // 10000 permintaan
      duration: 60,      // per 1 menit
      blockDuration: 1   // blokir 1 detik jika melebihi
    },
    csrf: {
      points: 5000,      // 5000 permintaan
      duration: 60,      // per 1 menit
      blockDuration: 1   // blokir 1 detik jika melebihi
    },
    auth: {
      points: 1000,      // 1000 permintaan
      duration: 60,      // per 1 menit
      blockDuration: 1   // blokir 1 detik jika melebihi
    }
  }
};

// Pilih konfigurasi berdasarkan environment
const config = RATE_LIMIT_CONFIG[isProduction ? 'production' : 'development'];

// Buat rate limiter umum
const rateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'middleware',
  points: config.general.points,
  duration: config.general.duration,
  blockDuration: config.general.blockDuration,
});

// Buat rate limiter khusus untuk endpoint CSRF token
const csrfRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'csrf',
  points: config.csrf.points,
  duration: config.csrf.duration,
  blockDuration: config.csrf.blockDuration,
});

// Buat rate limiter khusus untuk endpoint auth
const authRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'auth',
  points: config.auth.points,
  duration: config.auth.duration,
  blockDuration: config.auth.blockDuration,
});

// Fungsi untuk memeriksa apakah IP ada dalam whitelist
const isWhitelisted = (ip) => {
  return WHITELIST_IPS.includes(ip) ||
         process.env.NODE_ENV === 'development' ||
         process.env.DISABLE_RATE_LIMIT === 'true';
};

// Middleware untuk rate limiter umum
const rateLimiterMiddleware = (req, res, next) => {
  // Skip rate limiting untuk IP yang di-whitelist
  if (isWhitelisted(req.ip)) {
    return next();
  }

  rateLimiter.consume(req.ip)
    .then(() => {
      next();
    })
    .catch((rejRes) => {
      logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
      res.set('Retry-After', String(Math.round(rejRes.msBeforeNext / 1000) || 1));
      res.status(429).json({
        message: 'Too Many Requests',
        retryAfter: Math.ceil(rejRes.msBeforeNext / 1000),
        success: false
      });
    });
};

// Middleware untuk rate limiter CSRF token
const csrfRateLimiterMiddleware = (req, res, next) => {
  // Skip rate limiting untuk IP yang di-whitelist
  if (isWhitelisted(req.ip)) {
    return next();
  }

  csrfRateLimiter.consume(req.ip)
    .then(() => {
      next();
    })
    .catch((rejRes) => {
      logger.warn(`CSRF rate limit exceeded for IP: ${req.ip}`);
      res.set('Retry-After', String(Math.round(rejRes.msBeforeNext / 1000) || 1));
      res.status(429).json({
        message: 'Too Many CSRF Token Requests',
        retryAfter: Math.ceil(rejRes.msBeforeNext / 1000),
        success: false
      });
    });
};

// Middleware untuk rate limiter auth
const authRateLimiterMiddleware = (req, res, next) => {
  // Skip rate limiting untuk IP yang di-whitelist
  if (isWhitelisted(req.ip)) {
    return next();
  }

  authRateLimiter.consume(req.ip)
    .then(() => {
      next();
    })
    .catch((rejRes) => {
      logger.warn(`Auth rate limit exceeded for IP: ${req.ip}`);
      res.set('Retry-After', String(Math.round(rejRes.msBeforeNext / 1000) || 1));
      res.status(429).json({
        message: 'Too Many Authentication Requests',
        retryAfter: Math.ceil(rejRes.msBeforeNext / 1000),
        success: false
      });
    });
};

module.exports = {
  rateLimiterMiddleware,
  csrfRateLimiterMiddleware,
  authRateLimiterMiddleware,
  isWhitelisted
};
