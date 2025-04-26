// backend/config/googleAuth.js
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();
const { logger } = require('../utils/logger');

// Ambil Google Client ID dari environment variable
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

// Log untuk debugging
logger.info(`Using Google Client ID: ${GOOGLE_CLIENT_ID}`);
console.log('Backend using Google Client ID:', GOOGLE_CLIENT_ID);

// Buat client OAuth2 dengan Client ID yang benar
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleToken(token) {
  if (!token) {
    logger.error('No token provided');
    throw new Error('No token provided');
  }

  try {
    logger.info('Attempting to verify Google token...');

    // Verifikasi token dengan audience yang benar
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID, // Gunakan variabel yang sudah diambil dari env
    });

    const payload = ticket.getPayload();

    if (!payload) {
      logger.error('Invalid payload from Google token');
      throw new Error('Invalid payload');
    }

    logger.info(`Token verified successfully for email: ${payload.email}`);
    return payload;
  } catch (error) {
    logger.error(`Error verifying Google token: ${error.message}`, error);
    throw new Error('Invalid Google token');
  }
}

module.exports = { client, verifyGoogleToken };