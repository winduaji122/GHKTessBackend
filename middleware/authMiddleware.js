const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { executeQuery } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');

// Konfigurasi token
const TOKEN_CONFIG = {
  ACCESS: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m'
  }
};

// Middleware utama untuk verifikasi token
exports.verifyToken = async (req, res, next) => {
  try {
    // Cek token dari cookie
    const cookieToken = req.cookies.token;
    
    // Cek token dari header Authorization
    const authHeader = req.headers.authorization;
    const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    
    // Gunakan token dari cookie atau header
    const token = cookieToken || headerToken;
    
    if (!token) {
      logger.warn('No token provided in cookies or Authorization header');
      return res.status(401).json({
        code: 'NO_TOKEN',
        message: 'Token tidak ditemukan'
      });
    }
    
    // Log token untuk debugging (jangan lakukan ini di production)
    logger.info(`Token received: ${token.substring(0, 20)}...`);

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      logger.info(`Token verified successfully for user: ${decoded.id}`);
      
      // Cek user di database
      const [[user]] = await executeQuery(async (connection) => {
        return await connection.query(
          `SELECT id, email, role, is_admin, is_verified, is_approved 
           FROM users 
           WHERE id = ?`,
          [decoded.id]
        );
      });

      if (!user) {
        logger.warn(`User with ID ${decoded.id} not found in database`);
        return res.status(401).json({
          code: 'INVALID_USER',
          message: 'User tidak valid'
        });
      }
      
      // Log user info untuk debugging
      logger.info(`User found: ${JSON.stringify({
        id: user.id,
        email: user.email,
        role: user.role,
        is_admin: user.is_admin,
        is_verified: user.is_verified,
        is_approved: user.is_approved
      })}`);

      // Untuk endpoint verify-writer, kita tidak perlu memeriksa is_verified dan is_approved
      // karena admin perlu memverifikasi penulis yang belum terverifikasi
      if (req.path.includes('/verify-writer/')) {
        req.user = {
          id: user.id,
          email: user.email,
          role: user.role,
          is_admin: user.is_admin,
          is_verified: user.is_verified,
          is_approved: user.is_approved
        };
        logger.info(`Admin verification check bypassed for verify-writer endpoint`);
        return next();
      }

      // Untuk endpoint lain, periksa is_verified dan is_approved jika diperlukan
      if (user.role !== 'admin' && (!user.is_verified || !user.is_approved)) {
        logger.warn(`User ${user.id} is not verified or approved`);
        return res.status(403).json({
          code: 'USER_NOT_VERIFIED',
          message: 'Akun Anda belum diverifikasi atau disetujui'
        });
      }

      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        is_admin: user.is_admin,
        is_verified: user.is_verified,
        is_approved: user.is_approved
      };
      
      logger.info(`User authenticated: ${user.id}, role: ${user.role}`);
      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        logger.warn(`Token expired: ${jwtError.message}`);
        return res.status(401).json({
          code: 'TOKEN_EXPIRED',
          message: 'Token telah kadaluarsa, silakan refresh token'
        });
      }
      
      logger.error(`JWT verification error: ${jwtError.message}`);
      return res.status(401).json({
        code: 'INVALID_TOKEN',
        message: 'Token tidak valid'
      });
    }
  } catch (error) {
    logger.error(`Auth middleware error: ${error.message}`);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Terjadi kesalahan server'
    });
  }
};

// Alias untuk verifyToken
exports.isAuthenticated = exports.verifyToken;

// Role-based middleware
exports.isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    logger.warn('Access denied: User is not admin', { userId: req.user?.id });
    return res.status(403).json({ 
      message: 'Akses ditolak. Hanya untuk admin.',
      code: 'ADMIN_REQUIRED'
    });
  }
  logger.info('Admin access granted', { userId: req.user.id });
  next();
};

exports.isWriter = (req, res, next) => {
  if (!req.user || (req.user.role !== 'writer' && req.user.role !== 'admin')) {
    logger.warn('Access denied: User is not writer', { userId: req.user?.id });
    return res.status(403).json({ 
      message: 'Akses ditolak. Hanya untuk penulis.',
      code: 'WRITER_REQUIRED'
    });
  }
  next();
};

exports.isAdminOrWriter = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: 'Tidak terautentikasi',
        code: 'AUTH_REQUIRED'
      });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'writer') {
      return res.status(403).json({
        message: 'Akses ditolak. Hanya untuk admin atau writer.',
        code: 'ADMIN_OR_WRITER_REQUIRED'
      });
    }

    next();
  } catch (error) {
    logger.error('Error in isAdminOrWriter middleware:', error);
    res.status(500).json({
      message: 'Terjadi kesalahan saat memeriksa hak akses',
      error: error.message
    });
  }
};

exports.isAdminOrAuthor = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      message: 'Akses ditolak. Autentikasi diperlukan.',
      code: 'AUTH_REQUIRED'
    });
  }

  if (req.user.is_admin === 1) {
    return next();
  }

  try {
    const post = await executeQuery(async (connection) => {
      const [result] = await connection.query(
        'SELECT * FROM posts WHERE id = ?', 
        [req.params.id]
      );
      return result[0];
    });

    if (post && post.author_id === req.user.id) {
      return next();
    }

    logger.warn('Access denied: User is not admin or author', { 
      userId: req.user.id,
      postId: req.params.id 
    });

    return res.status(403).json({ 
      message: 'Akses ditolak. Hanya untuk admin atau penulis post ini.',
      code: 'ADMIN_OR_AUTHOR_REQUIRED'
    });
  } catch (error) {
    logger.error('Admin or author check error:', error);
    return res.status(500).json({ 
      message: 'Terjadi kesalahan server internal.',
      code: 'SERVER_ERROR'
    });
  }
};

// Middleware untuk mengautentikasi admin
exports.authorizeAdmin = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        code: 'NO_USER',
        message: 'User tidak ditemukan'
      });
    }
    
    if (req.user.role !== 'admin' && !req.user.is_admin) {
      return res.status(403).json({
        code: 'NOT_ADMIN',
        message: 'Akses ditolak, hanya admin yang diizinkan'
      });
    }
    
    next();
  } catch (error) {
    logger.error('Admin authorization error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Terjadi kesalahan server'
    });
  }
};

// Middleware untuk mengautentikasi writer
exports.authorizeWriter = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        code: 'NO_USER',
        message: 'User tidak ditemukan'
      });
    }
    
    if (req.user.role !== 'writer' && req.user.role !== 'admin' && !req.user.is_admin) {
      return res.status(403).json({
        code: 'NOT_WRITER',
        message: 'Akses ditolak, hanya writer yang diizinkan'
      });
    }
    
    next();
  } catch (error) {
    logger.error('Writer authorization error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Terjadi kesalahan server'
    });
  }
};

exports.authenticateJWT = (req, res, next) => {
  try {
    // Cek token dari cookie
    const token = req.cookies.token;
    
    // Jika tidak ada token di cookie, cek di header Authorization
    const authHeader = req.headers.authorization;
    const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    
    // Gunakan token dari cookie atau header
    const finalToken = token || headerToken;
    
    if (!finalToken) {
      logger.warn('No token provided in cookies or Authorization header');
      return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }
    
    jwt.verify(finalToken, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        logger.error(`JWT verification error: ${err.message}`);
        return res.status(401).json({ message: 'Unauthorized: Invalid token' });
      }
      
      req.user = decoded;
      logger.info(`User authenticated: ${decoded.id}, role: ${decoded.role}`);
      next();
    });
  } catch (error) {
    logger.error(`Error in authenticateJWT middleware: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
