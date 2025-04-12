// backend/config.js
require('dotenv').config();

module.exports = {
    googleAuth: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback',
    },
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN
    },
    database: {
      url: process.env.DATABASE_URL,
    },
    server: {
      port: process.env.PORT || 5000,
    },
  };