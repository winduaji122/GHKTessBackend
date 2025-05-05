// utils/logger.js
const winston = require('winston');

// Tentukan level logging berdasarkan environment
const getLogLevel = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.LOG_LEVEL || 'warn'; // Hanya log warn, error, dan fatal di production
  }
  return process.env.LOG_LEVEL || 'info'; // Log semua di development
};

// Filter untuk mengurangi log berlebihan di production
const productionFilter = winston.format((info, opts) => {
  // Di production, filter beberapa log yang tidak penting
  if (process.env.NODE_ENV === 'production') {
    // Skip log cache hit/miss kecuali jika DEBUG_CACHE=true
    if (info.service === 'cache-service' &&
        (info.message.includes('Cache hit') || info.message.includes('Cache miss')) &&
        process.env.DEBUG_CACHE !== 'true') {
      return false;
    }

    // Skip log koneksi database yang berlebihan
    if (info.service === 'database-service' &&
        (info.message.includes('Connection acquired') ||
         info.message.includes('Connection released'))) {
      return false;
    }
  }
  return info;
});

const logFormat = winston.format.combine(
  productionFilter(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Konfigurasi format untuk console
const consoleFormat = winston.format.combine(
  productionFilter(),
  winston.format.colorize(),
  winston.format.simple(),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}] : ${message} `;

    // Di production, tampilkan metadata yang lebih ringkas
    if (process.env.NODE_ENV === 'production') {
      // Hanya tampilkan metadata penting
      const importantKeys = ['error', 'service', 'userId', 'postId'];
      const filteredMetadata = {};

      importantKeys.forEach(key => {
        if (metadata[key] !== undefined) {
          filteredMetadata[key] = metadata[key];
        }
      });

      if (Object.keys(filteredMetadata).length > 0) {
        msg += JSON.stringify(filteredMetadata);
      }
    } else {
      // Di development, tampilkan semua metadata
      if (Object.keys(metadata).length > 0) {
        msg += JSON.stringify(metadata);
      }
    }

    return msg;
  })
);

// Buat logger dengan konfigurasi yang berbeda berdasarkan environment
const logger = winston.createLogger({
  level: getLogLevel(),
  format: logFormat,
  defaultMeta: { service: 'user-service' },
  transports: [
    new winston.transports.Console({
      format: consoleFormat
    })
  ],
});

// Tambahkan metode helper untuk logging yang lebih efisien
logger.logAndThrow = (level, message, error) => {
  logger.log(level, message, { error: error.message, stack: error.stack });
  throw error;
};

// Tambahkan metode debug yang hanya berjalan di development
logger.debug = (message, metadata = {}) => {
  if (process.env.NODE_ENV !== 'production' || process.env.DEBUG === 'true') {
    logger.log('debug', message, metadata);
  }
};

module.exports = { logger };
