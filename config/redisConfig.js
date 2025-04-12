const Redis = require('ioredis');
const { logger } = require('../utils/logger');

// Konfigurasi Redis
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  db: process.env.REDIS_DB || 0,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  connectTimeout: 10000,
  lazyConnect: true
};

// Buat instance Redis
const redis = new Redis(redisConfig);

// Event handlers
redis.on('connect', () => {
  logger.info('Redis connected successfully');
});

redis.on('error', (error) => {
  logger.error('Redis connection error:', error);
});

redis.on('reconnecting', () => {
  logger.info('Redis reconnecting...');
});

redis.on('ready', () => {
  logger.info('Redis is ready to accept commands');
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

// Fungsi helper untuk operasi Redis
const redisHelper = {
  // Set key dengan expiry
  async set(key, value, expirySeconds = 3600) {
    try {
      await redis.set(key, JSON.stringify(value), 'EX', expirySeconds);
      return true;
    } catch (error) {
      logger.error('Redis set error:', error);
      return false;
    }
  },

  // Get key
  async get(key) {
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis get error:', error);
      return null;
    }
  },

  // Delete key
  async del(key) {
    try {
      await redis.del(key);
      return true;
    } catch (error) {
      logger.error('Redis delete error:', error);
      return false;
    }
  },

  // Clear semua keys
  async clear() {
    try {
      await redis.flushall();
      return true;
    } catch (error) {
      logger.error('Redis clear error:', error);
      return false;
    }
  },

  // Set multiple keys
  async mset(keys) {
    try {
      const pipeline = redis.pipeline();
      Object.entries(keys).forEach(([key, value]) => {
        pipeline.set(key, JSON.stringify(value));
      });
      await pipeline.exec();
      return true;
    } catch (error) {
      logger.error('Redis mset error:', error);
      return false;
    }
  },

  // Get multiple keys
  async mget(keys) {
    try {
      const values = await redis.mget(keys);
      return values.map(value => value ? JSON.parse(value) : null);
    } catch (error) {
      logger.error('Redis mget error:', error);
      return null;
    }
  },

  // Check if key exists
  async exists(key) {
    try {
      return await redis.exists(key);
    } catch (error) {
      logger.error('Redis exists error:', error);
      return false;
    }
  },

  // Set key with hash
  async hset(key, field, value) {
    try {
      await redis.hset(key, field, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error('Redis hset error:', error);
      return false;
    }
  },

  // Get hash field
  async hget(key, field) {
    try {
      const value = await redis.hget(key, field);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis hget error:', error);
      return null;
    }
  }
};

module.exports = {
  redis,
  redisHelper
}; 