const { redis } = require('../config/databaseConfig');
const { logger } = require('./logger');

const DEFAULT_EXPIRATION = 3600; // 1 hour

async function getOrSetCache(key, cb) {
  try {
    const data = await redis.get(key);
    if (data != null) {
      return JSON.parse(data);
    }
    const freshData = await cb();
    await redis.setex(key, DEFAULT_EXPIRATION, JSON.stringify(freshData));
    return freshData;
  } catch (error) {
    logger.error('Cache error:', error);
    return cb();
  }
}

module.exports = { getOrSetCache };