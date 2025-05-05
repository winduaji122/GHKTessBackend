const { redis } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');

// Durasi cache default berdasarkan jenis data
const CACHE_DURATION = {
  short: 60 * 5,        // 5 menit
  medium: 60 * 30,      // 30 menit
  long: 60 * 60 * 2     // 2 jam
};

// In-memory cache sebagai fallback jika Redis tidak tersedia
const memoryCache = new Map();

// Fungsi untuk mendapatkan data dari cache (Redis atau memory)
const getFromCache = async (key) => {
  try {
    // Coba ambil dari Redis terlebih dahulu
    if (redis) {
      const data = await redis.get(key);
      if (data) {
        return JSON.parse(data);
      }
    }

    // Fallback ke memory cache jika Redis tidak tersedia atau data tidak ditemukan
    if (memoryCache.has(key)) {
      const item = memoryCache.get(key);
      // Periksa apakah cache sudah expired
      if (item.expires > Date.now()) {
        return item.data;
      } else {
        // Hapus cache yang sudah expired
        memoryCache.delete(key);
      }
    }

    return null;
  } catch (error) {
    logger.error('Error getting from cache:', {
      error: error.message,
      key,
      service: 'cache-service'
    });
    return null;
  }
};

// Fungsi untuk menyimpan data ke cache (Redis atau memory)
const setToCache = async (key, data, duration) => {
  try {
    // Coba simpan ke Redis terlebih dahulu
    if (redis) {
      await redis.setex(key, duration, JSON.stringify(data));
    }

    // Simpan juga ke memory cache sebagai fallback
    memoryCache.set(key, {
      data,
      expires: Date.now() + (duration * 1000)
    });

    return true;
  } catch (error) {
    logger.error('Error setting to cache:', {
      error: error.message,
      key,
      service: 'cache-service'
    });

    // Jika Redis gagal, tetap simpan ke memory cache
    memoryCache.set(key, {
      data,
      expires: Date.now() + (duration * 1000)
    });

    return false;
  }
};

const cacheMiddleware = (duration = CACHE_DURATION.medium, key) => {
  return async (req, res, next) => {
    // Selalu aktifkan caching di production
    if (process.env.NODE_ENV === 'development' && !process.env.FORCE_CACHE) {
      return next();
    }

    // Gunakan URL sebagai cache key jika tidak ada key yang diberikan
    const cacheKey = key || req.originalUrl;

    // Tambahkan query params ke cache key jika ada
    const fullCacheKey = Object.keys(req.query).length > 0
      ? `${cacheKey}?${new URLSearchParams(req.query).toString()}`
      : cacheKey;

    try {
      // Coba ambil data dari cache
      const cachedData = await getFromCache(fullCacheKey);

      if (cachedData) {
        // Hanya log di level debug untuk mengurangi log berlebihan
        if (process.env.DEBUG_CACHE === 'true') {
          logger.info(`Cache hit for: ${fullCacheKey}`, { service: 'cache-service' });
        }
        return res.json(cachedData);
      }

      // Hanya log di level debug untuk mengurangi log berlebihan
      if (process.env.DEBUG_CACHE === 'true') {
        logger.info(`Cache miss for: ${fullCacheKey}`, { service: 'cache-service' });
      }

      // Override res.json untuk menyimpan response ke cache
      const originalJson = res.json;
      res.json = function(data) {
        // Hanya cache response yang sukses
        if (this.statusCode >= 200 && this.statusCode < 300 && data) {
          setToCache(fullCacheKey, data, duration)
            .then(success => {
              if (process.env.DEBUG_CACHE === 'true' && success) {
                logger.info(`Cache set for: ${fullCacheKey}, expires in ${duration}s`, {
                  service: 'cache-service'
                });
              }
            });
        }

        originalJson.call(this, data);
      };

      next();
    } catch (error) {
      logger.error('Cache error:', {
        error: error.message,
        stack: error.stack,
        key: fullCacheKey,
        service: 'cache-service'
      });
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
