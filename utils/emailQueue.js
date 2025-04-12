// utils/emailQueue.js
const Queue = require('bull');
const { sendEmail } = require('./emailService');

const emailQueue = new Queue('email', process.env.REDIS_URL);

emailQueue.process(async (job) => {
  const { to, subject, html } = job.data;
  await sendEmail(to, subject, html);
});

function addEmailJob(to, subject, html) {
  return emailQueue.add({ to, subject, html });
}

module.exports = { addEmailJob };