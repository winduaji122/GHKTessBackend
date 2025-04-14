const { RateLimiterRedis } = require('rate-limiter-flexible');
const { redis } = require('../config/databaseConfig');
const { logger } = require('./logger');

// Whitelist IP untuk pengujian dan development
const WHITELIST_IPS = [
  '127.0.0.1',
  'localhost',
  '::1',
  // Tambahkan IP Anda di sini jika diperlukan
  // Tambahkan IP publik Anda untuk testing
  '0.0.0.0', // Placeholder untuk semua IP (hanya untuk debugging)
];

// Tambahkan IP dari environment variable jika ada
if (process.env.WHITELIST_IPS) {
  try {
    const additionalIPs = process.env.WHITELIST_IPS.split(',').map(ip => ip.trim());
    WHITELIST_IPS.push(...additionalIPs);
    console.log('Added whitelist IPs from environment:', additionalIPs);
  } catch (error) {
    console.error('Error parsing WHITELIST_IPS environment variable:', error);
  }
}

// Log whitelist IPs untuk debugging
console.log('Current whitelist IPs:', WHITELIST_IPS);

// Konfigurasi rate limiter berdasarkan environment
const isProduction = process.env.NODE_ENV === 'production';
const RATE_LIMIT_CONFIG = {
  // Konfigurasi untuk production
  production: {
    general: {
      points: 2000,      // 2000 permintaan
      duration: 60 * 15, // per 15 menit
      blockDuration: 30  // blokir 30 detik jika melebihi
    },
    csrf: {
      points: 1000,      // 1000 permintaan
      duration: 60 * 15, // per 15 menit
      blockDuration: 15  // blokir 15 detik jika melebihi
    },
    auth: {
      points: 500,       // 500 permintaan
      duration: 60 * 15, // per 15 menit
      blockDuration: 30  // blokir 30 detik jika melebihi
    },
    login: {
      points: 500,       // 500 permintaan login
      duration: 60 * 15, // per 15 menit
      blockDuration: 5   // blokir 5 detik jika melebihi
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
      points: 2000,      // 2000 permintaan
      duration: 60,      // per 1 menit
      blockDuration: 1   // blokir 1 detik jika melebihi
    },
    login: {
      points: 5000,      // 5000 permintaan login
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

// Buat rate limiter khusus untuk endpoint login
const loginRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'login',
  points: config.login.points,
  duration: config.login.duration,
  blockDuration: config.login.blockDuration,
});

// Fungsi untuk memeriksa apakah IP ada dalam whitelist
const isWhitelisted = (ip) => {
  // Log IP untuk debugging
  logger.info(`Checking IP whitelist for: ${ip}`);

  // Jika DISABLE_RATE_LIMIT=true, selalu return true
  if (process.env.DISABLE_RATE_LIMIT === 'true') {
    logger.info('Rate limiting disabled via environment variable');
    return true;
  }

  // Jika dalam mode development, selalu return true
  if (process.env.NODE_ENV === 'development') {
    logger.info('Rate limiting disabled in development mode');
    return true;
  }

  // Cek apakah IP ada dalam whitelist
  const isInWhitelist = WHITELIST_IPS.some(whitelistedIp => {
    // Exact match
    if (ip === whitelistedIp) return true;

    // CIDR match (future implementation)
    // if (isCidrMatch(ip, whitelistedIp)) return true;

    return false;
  });

  if (isInWhitelist) {
    logger.info(`IP ${ip} is in whitelist`);
  }

  return isInWhitelist;
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

// Middleware untuk rate limiter login
const loginRateLimiterMiddleware = (req, res, next) => {
  // Log untuk debugging
  logger.info(`Login attempt from IP: ${req.ip}, User-Agent: ${req.headers['user-agent']}`);

  // PENTING: Menonaktifkan rate limiter untuk login sementara
  // Selalu izinkan permintaan login tanpa rate limiting
  logger.info('Rate limiting for login is DISABLED');
  return next();

  /* KODE ASLI DINONAKTIFKAN
  // Skip rate limiting untuk IP yang di-whitelist
  if (isWhitelisted(req.ip)) {
    logger.info(`IP ${req.ip} is whitelisted, skipping rate limit for login`);
    return next();
  }

  // Gunakan kombinasi IP + user agent untuk mengurangi false positive
  // Tambahkan email sebagai bagian dari key untuk membedakan antar user
  const email = req.body?.email || 'unknown';
  const userAgent = (req.headers['user-agent'] || 'unknown').substring(0, 20);
  const key = `login-${req.ip}-${userAgent}-${email}`;

  logger.info(`Login rate limit key: ${key}`);

  // Coba consume point dari rate limiter
  loginRateLimiter.consume(key)
    .then(() => {
      logger.info(`Login rate limit passed for key: ${key}`);
      next();
    })
    .catch((rejRes) => {
      logger.warn(`Login rate limit exceeded for IP: ${req.ip}, key: ${key}`);
      logger.warn(`Retry after: ${Math.ceil(rejRes.msBeforeNext / 1000)} seconds`);

      // Set header Retry-After
      const retryAfter = Math.ceil(rejRes.msBeforeNext / 1000) || 1;
      res.set('Retry-After', String(retryAfter));

      // Kirim respons 429 dengan informasi retry
      res.status(429).json({
        message: 'Too Many Login Attempts',
        retryAfter: retryAfter,
        success: false
      });
    });
  */
};

module.exports = {
  rateLimiterMiddleware,
  csrfRateLimiterMiddleware,
  authRateLimiterMiddleware,
  loginRateLimiterMiddleware,
  isWhitelisted
};
