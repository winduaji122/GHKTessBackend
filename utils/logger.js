// utils/logger.js
const winston = require('winston');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Konfigurasi format untuk console
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.simple(),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}] : ${message} `;
    if (Object.keys(metadata).length > 0) {
      msg += JSON.stringify(metadata);
    }
    return msg;
  })
);

// Buat logger yang hanya menggunakan Console transport
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'user-service' },
  transports: [
    new winston.transports.Console({
      format: consoleFormat
    })
  ],
});

logger.logAndThrow = (level, message, error) => {
  logger.log(level, message, { error: error.message, stack: error.stack });
  throw error;
};

// Komentar atau hapus bagian ini
// if (process.env.NODE_ENV === 'production') {
//   logger.add(new winston.transports.Mail({
//     to: 'admin@example.com',
//     level: 'error'
//   }));
// }

module.exports = { logger };
