const { RateLimiterRedis } = require('rate-limiter-flexible');
const { redis } = require('../config/databaseConfig');
const { logger } = require('./logger');

// Buat rate limiter dengan batas yang lebih tinggi
const rateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'middleware',
  points: 500, // Meningkatkan batas permintaan
  duration: 60,
  blockDuration: 60 * 2, // Mengurangi waktu blokir menjadi 2 menit
});

// Buat rate limiter khusus untuk endpoint CSRF token
const csrfRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'csrf',
  points: 1000, // Batas yang jauh lebih tinggi untuk CSRF token
  duration: 60,
  blockDuration: 60, // Blokir hanya 1 menit
});

// Middleware untuk rate limiter umum
const rateLimiterMiddleware = (req, res, next) => {
  rateLimiter.consume(req.ip)
    .then(() => {
      next();
    })
    .catch((rejRes) => {
      logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
      res.set('Retry-After', String(Math.round(rejRes.msBeforeNext / 1000) || 1));
      res.status(429).json({ message: 'Too Many Requests', retryAfter: rejRes.msBeforeNext / 1000 });
    });
};

// Middleware untuk rate limiter CSRF token
const csrfRateLimiterMiddleware = (req, res, next) => {
  csrfRateLimiter.consume(req.ip)
    .then(() => {
      next();
    })
    .catch((rejRes) => {
      logger.warn(`CSRF rate limit exceeded for IP: ${req.ip}`);
      res.set('Retry-After', String(Math.round(rejRes.msBeforeNext / 1000) || 1));
      res.status(429).json({ message: 'Too Many CSRF Token Requests', retryAfter: rejRes.msBeforeNext / 1000 });
    });
};

module.exports = {
  rateLimiterMiddleware,
  csrfRateLimiterMiddleware
};
