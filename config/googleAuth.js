// backend/config/googleAuth.js
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleToken(token) {
  if (!token) {
    throw new Error('No token provided');
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    
    if (!payload) {
      throw new Error('Invalid payload');
    }
    logger.info('Token verified successfully');
    return payload;
  } catch (error) {
    logger.error('Error verifying Google token:', error);
    throw new Error('Invalid Google token');
  }
}

module.exports = { client, verifyGoogleToken };