const { redis } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');

const cacheMiddleware = (duration, key) => {
  return async (req, res, next) => {
    if (process.env.NODE_ENV === 'development') {
      return next();
    }

    const cacheKey = key || req.originalUrl;
    
    try {
      const cachedData = await redis.get(cacheKey);
      
      if (cachedData) {
        logger.info(`Cache hit for: ${cacheKey}`);
        return res.json(JSON.parse(cachedData));
      }

      // Override res.json untuk menyimpan response ke cache
      const originalJson = res.json;
      res.json = function(data) {
        redis.setex(cacheKey, duration, JSON.stringify(data))
          .catch(err => logger.error('Error setting cache:', err));
        originalJson.call(this, data);
      };

      next();
    } catch (error) {
      logger.error('Cache error:', error);
      next();
    }
  };
};

const clearCache = async (pattern) => {
  try {
    const keys = await redis.keys(`*${pattern}*`);
    if (keys.length > 0) {
      await redis.del(keys);
      logger.info(`Cache cleared for pattern: ${pattern}`);
    }
  } catch (error) {
    logger.error('Error clearing cache:', error);
  }
};

module.exports = { cacheMiddleware, clearCache };
