// utils/emailQueue.js
const Queue = require('bull');
const { sendEmail } = require('./emailService');
const { logger } = require('./logger');

// Cek apakah Redis diaktifkan
const redisEnabled = process.env.REDIS_ENABLED === 'true';
let emailQueue = null;

if (redisEnabled) {
  try {
    emailQueue = new Queue('email', process.env.REDIS_URL);

    emailQueue.process(async (job) => {
      const { to, subject, html } = job.data;
      await sendEmail(to, subject, html);
    });

    emailQueue.on('error', (error) => {
      logger.error('Email queue error:', error);
    });

    logger.info('Email queue initialized with Redis');
  } catch (error) {
    logger.error('Failed to initialize email queue with Redis:', error);
    emailQueue = null;
  }
} else {
  logger.info('Redis disabled, email queue will send emails directly');
}

async function addEmailJob(to, subject, html) {
  if (emailQueue) {
    try {
      return await emailQueue.add({ to, subject, html });
    } catch (error) {
      logger.error('Error adding job to email queue, sending directly:', error);
      return sendEmail(to, subject, html);
    }
  } else {
    // Fallback to direct email sending if Redis is disabled
    return sendEmail(to, subject, html);
  }
}

module.exports = { addEmailJob };