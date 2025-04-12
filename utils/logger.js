// utils/logger.js
const winston = require('winston');
// Komentar atau hapus baris ini
// require('winston-mail');
const path = require('path');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'user-service' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true,
      zippedArchive: true,
    }),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/warn.log'), 
      level: 'warn',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ level, message, timestamp, ...metadata }) => {
        let msg = `${timestamp} [${level}] : ${message} `;
        if (Object.keys(metadata).length > 0) {
          msg += JSON.stringify(metadata);
        }
        return msg;
      })
    ),
  }));
}

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
