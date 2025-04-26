const { redis } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');

// Durasi cache default berdasarkan jenis data
const CACHE_DURATION = {
  short: 60 * 5,        // 5 menit
  medium: 60 * 30,      // 30 menit
  long: 60 * 60 * 2     // 2 jam
};

const cacheMiddleware = (duration = CACHE_DURATION.medium, key) => {
  return async (req, res, next) => {
    // Selalu aktifkan caching di production
    if (process.env.NODE_ENV === 'development' && !process.env.FORCE_CACHE) {
      return next();
    }

    // Gunakan URL sebagai cache key jika tidak ada key yang diberikan
    const cacheKey = key || req.originalUrl;

    try {
      // Coba ambil data dari cache
      const cachedData = await redis.get(cacheKey);

      if (cachedData) {
        logger.info(`Cache hit for: ${cacheKey}`, { service: 'cache-service' });
        return res.json(JSON.parse(cachedData));
      }

      logger.info(`Cache miss for: ${cacheKey}`, { service: 'cache-service' });

      // Override res.json untuk menyimpan response ke cache
      const originalJson = res.json;
      res.json = function(data) {
        // Hanya cache response yang sukses
        if (this.statusCode >= 200 && this.statusCode < 300 && data) {
          redis.setex(cacheKey, duration, JSON.stringify(data))
            .catch(err => logger.error('Error setting cache:', { error: err.message, key: cacheKey, service: 'cache-service' }));

          logger.info(`Cache set for: ${cacheKey}, expires in ${duration}s`, { service: 'cache-service' });
        }

        originalJson.call(this, data);
      };

      next();
    } catch (error) {
      logger.error('Cache error:', { error: error.message, stack: error.stack, key: cacheKey, service: 'cache-service' });
      next();
    }
  };
};

const clearCache = async (pattern) => {
  try {
    const keys = await redis.keys(`*${pattern}*`);
    if (keys.length > 0) {
      await redis.del(keys);
      logger.info(`Cache cleared for pattern: ${pattern}`, { service: 'cache-service', keysCount: keys.length });
    }
  } catch (error) {
    logger.error('Error clearing cache:', { error: error.message, pattern, service: 'cache-service' });
  }
};

// Fungsi untuk membersihkan semua cache
const clearAllCache = async () => {
  try {
    const keys = await redis.keys('*');
    if (keys.length > 0) {
      await redis.del(keys);
      logger.info(`All cache cleared`, { service: 'cache-service', keysCount: keys.length });
    }
  } catch (error) {
    logger.error('Error clearing all cache:', { error: error.message, service: 'cache-service' });
  }
};

// Ekspor konstanta durasi cache
module.exports = { cacheMiddleware, clearCache, clearAllCache, CACHE_DURATION };
