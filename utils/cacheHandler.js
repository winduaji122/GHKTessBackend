const { redis, redisEnabled } = require('../config/databaseConfig');
const { logger } = require('./logger');

// Dummy cache untuk digunakan ketika Redis tidak tersedia
const memoryCache = new Map();

const clearCache = async (pattern) => {
  // Skip jika Redis tidak diaktifkan
  if (!redisEnabled) {
    return;
  }

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

const setCache = async (key, data, expires = 300) => {
  // Skip jika Redis tidak diaktifkan
  if (!redisEnabled) {
    return;
  }

  try {
    await redis.setex(key, expires, JSON.stringify(data));
    logger.info(`Cache set for key: ${key}`);
  } catch (error) {
    logger.error('Error setting cache:', error);
  }
};

const getCache = async (key) => {
  // Skip jika Redis tidak diaktifkan
  if (!redisEnabled) {
    return null;
  }

  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logger.error('Error getting cache:', error);
    return null;
  }
};

const cacheKeys = {
  SPOTLIGHT_POSTS: 'spotlight_posts',
  FEATURED_POSTS: 'featured_posts',
  POST_DETAIL: (id) => `post_${id}`,
  ALL_POSTS: (params) => `all_posts_${JSON.stringify(params)}`
};

module.exports = {
  clearCache,
  setCache,
  getCache,
  cacheKeys
};