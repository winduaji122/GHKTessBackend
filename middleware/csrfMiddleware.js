const crypto = require('crypto');
const { logger } = require('../utils/logger');

const isProduction = process.env.NODE_ENV === 'production';

// Generate token
const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// CSRF Protection middleware
const csrfProtection = (req, res, next) => {
  if (req.method === 'GET') {
    // Untuk GET request, generate token baru
    const token = generateToken();
    res.cookie('XSRF-TOKEN', token, {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax'
    });
    // Set token di header response juga
    res.setHeader('X-CSRF-Token', token);
    return next();
  }

  const token = req.headers['x-csrf-token'];
  const cookieToken = req.cookies['XSRF-TOKEN'];

  if (!token || !cookieToken || token !== cookieToken) {
    logger.warn('CSRF Token Error:', {
      path: req.path,
      method: req.method,
      headerToken: token?.slice(0, 10),
      cookieToken: cookieToken?.slice(0, 10)
    });

    return res.status(403).json({
      error: 'Invalid CSRF token',
      message: 'Silakan refresh halaman dan coba lagi'
    });
  }

  next();
};

// Error handler
const handleCsrfError = (err, req, res, next) => {
  if (err.code === 'CSRF_ERROR') {
    logger.warn('CSRF Token Error:', {
      path: req.path,
      method: req.method,
      headers: {
        origin: req.headers.origin,
        referer: req.headers.referer,
        'x-csrf-token': req.headers['x-csrf-token']
      }
    });
    return res.status(403).json({
      error: 'Invalid CSRF token',
      message: 'Silakan refresh halaman dan coba lagi'
    });
  }
  next(err);
};

module.exports = {
  csrfProtection,
  handleCsrfError,
  generateToken
}; 