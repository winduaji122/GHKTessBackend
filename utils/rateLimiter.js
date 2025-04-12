const { RateLimiterRedis } = require('rate-limiter-flexible');
const { redis } = require('../config/databaseConfig');
const { logger } = require('./logger');

const rateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'middleware',
  points: 200,
  duration: 60,
  blockDuration: 60 * 5, // Block for 5 minutes after reaching limit
});

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

module.exports = rateLimiterMiddleware;
