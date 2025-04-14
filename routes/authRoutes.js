const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const adminController = require('../controllers/adminController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Konfigurasi penyimpanan untuk upload gambar profil
const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/profiles');
    // Buat direktori jika belum ada
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'profile-' + uniqueSuffix + ext);
  }
});

// Filter file untuk memastikan hanya gambar yang diupload
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Hanya file gambar yang diperbolehkan'), false);
  }
};

const upload = multer({
  storage: profileStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});
const {
  verifyToken,
  isAdmin,
  isAdminOrWriter,
  checkTokenBlacklist,
  authenticateJWT,
  authorizeAdmin
} = require('../middleware/authMiddleware');
const {
    validateRegistration,
    validateLogin,
    validateProfileUpdate,
    validatePasswordReset,
    validateForgotPassword
} = require('../middleware/validationMiddleware');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const userService = require('../services/userService');
const emailService = require('../utils/emailService');
const { logger } = require('../utils/logger');
const { executeQuery } = require('../config/databaseConfig');

// Rate Limiters dengan konfigurasi yang lebih ketat
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 menit
  max: 20, // Meningkatkan batas untuk auth
  message: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Terlalu banyak percobaan, silakan coba lagi nanti.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate Limiter khusus untuk CSRF token dengan batas yang lebih tinggi
const csrfLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 menit
  max: 100, // Batas yang jauh lebih tinggi untuk CSRF token
  message: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Terlalu banyak permintaan token, silakan coba lagi nanti.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 jam
  max: 3,
  message: {
    code: 'EMAIL_LIMIT_EXCEEDED',
    message: 'Terlalu banyak permintaan email, silakan coba lagi nanti.'
  }
});

// CSRF Protection
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
});

// Public Routes (tidak perlu token)
router.post('/register', authLimiter, validateRegistration, authController.register);
router.post('/login', authLimiter, csrfProtection, validateLogin, authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post('/google-login', authLimiter, authController.googleLogin);
router.get('/verify/:token', authController.verifyEmail);
router.post('/forgot-password', emailLimiter, validateForgotPassword, authController.forgotPassword);
router.post('/reset-password', authLimiter, validatePasswordReset, authController.resetPassword);
router.get('/csrf-token', csrfLimiter, csrfProtection, authController.getCsrfToken);

// Global middleware untuk semua route di bawah
router.use((req, res, next) => {
  logger.info(`Auth route accessed: ${req.method} ${req.path}`);
  console.log('Time:', Date.now());
  next();
});

// Auth middleware
router.use(verifyToken);

// Protected Routes
router.post('/logout', authController.logout);
router.get('/token-status', verifyToken, async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.split(' ')[1];
    const decoded = jwt.decode(accessToken);
    const currentTime = Date.now() / 1000;
    const timeLeft = decoded.exp - currentTime;

    res.json({
      shouldRefresh: timeLeft < TOKEN_CONFIG.ACCESS.refreshThreshold,
      timeLeft: Math.floor(timeLeft),
      expiresAt: new Date(decoded.exp * 1000).toISOString()
    });
  } catch (error) {
    res.json({ shouldRefresh: true });
  }
});
router.get('/check-auth', authController.checkAuth);
router.get('/me', authController.getMe);
router.put('/profile', validateProfileUpdate, authController.updateProfile);
router.get('/validate-session', async (req, res) => {
  try {
    res.json({
      valid: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        is_admin: req.user.is_admin
      }
    });
  } catch (error) {
    logger.error('Error validating session:', error);
    res.status(401).json({
      valid: false,
      code: 'SESSION_INVALID'
    });
  }
});

// Middleware admin
router.use(isAdmin);
router.get('/pending-writers', adminController.getPendingWriters);
router.put('/approve-user/:userId', adminController.approveUser);
router.get('/users', adminController.getAllUsers);
router.put('/update-user-role/:userId', adminController.updateUserRole);
router.delete('/delete-user/:userId', adminController.deleteUser);
router.get('/user-stats', adminController.getUserStats);
router.get('/writers', adminController.getApprovedWriters);
router.post('/create-writer', validateRegistration, adminController.createWriter);
router.get('/admin-dashboard', adminController.adminDashboard);

// Endpoint untuk memverifikasi writer
router.post('/verify-writer/:id', authenticateJWT, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    logger.info(`Verifying writer with ID: ${id}`);

    // Log user yang melakukan verifikasi
    logger.info(`Verification requested by user: ${req.user.id}, role: ${req.user.role}`);

    // Cek apakah user dengan ID tersebut ada
    const [[user]] = await executeQuery(async (connection) => {
      return await connection.query(
        'SELECT * FROM users WHERE id = ?',
        [id]
      );
    });

    if (!user) {
      logger.warn(`User with ID ${id} not found`);
      return res.status(404).json({
        code: 'USER_NOT_FOUND',
        message: 'Pengguna tidak ditemukan'
      });
    }

    // Log user yang akan diverifikasi
    logger.info(`User to verify: ${JSON.stringify({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      is_verified: user.is_verified,
      is_approved: user.is_approved
    })}`);

    // Cek apakah user adalah writer
    if (user.role !== 'writer') {
      logger.warn(`User ${id} is not a writer (role: ${user.role})`);
      return res.status(400).json({
        code: 'NOT_WRITER',
        message: 'Pengguna bukan writer'
      });
    }

    // Cek apakah user sudah diverifikasi
    if (user.is_verified) {
      logger.info(`Writer ${id} is already verified`);
      return res.status(200).json({
        code: 'ALREADY_VERIFIED',
        message: 'Writer sudah diverifikasi sebelumnya',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          is_verified: true,
          is_approved: user.is_approved
        }
      });
    }

    // Update status verifikasi user
    const result = await executeQuery(async (connection) => {
      return await connection.query(
        'UPDATE users SET is_verified = 1 WHERE id = ?',
        [id]
      );
    });

    if (!result || result[0].affectedRows === 0) {
      logger.error(`Failed to update verification status for user ${id}`);
      return res.status(500).json({
        code: 'UPDATE_FAILED',
        message: 'Gagal memperbarui status verifikasi'
      });
    }

    logger.info(`Writer ${id} has been verified`);

    // Kirim email notifikasi verifikasi
    try {
      // Gunakan template email verifikasi writer
      const { writerVerificationTemplate } = require('../utils/emailTemplates');
      const loginLink = `${process.env.FRONTEND_URL}/login`;
      const emailContent = writerVerificationTemplate(user.name || user.username, loginLink);

      await emailService.sendEmail(
        user.email,
        'Akun Writer Anda Telah Diverifikasi',
        emailContent
      );

      logger.info(`Verification notification email sent to ${user.email}`);
    } catch (emailError) {
      logger.error(`Error sending verification email: ${emailError.message}`);
      // Lanjutkan meskipun email gagal terkirim
    }

    // Set header untuk mencegah caching
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).json({
      code: 'VERIFICATION_SUCCESS',
      message: 'Writer berhasil diverifikasi',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        is_verified: true,
        is_approved: user.is_approved
      }
    });
  } catch (error) {
    logger.error(`Error verifying writer: ${error.message}`);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      message: 'Terjadi kesalahan saat memverifikasi writer'
    });
  }
});

// Endpoint untuk menyetujui writer
router.post('/approve-writer/:id', authenticateJWT, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    logger.info(`Approving writer with ID: ${id}`);

    // Cek apakah user dengan ID tersebut ada
    const user = await userService.getUserById(id);
    if (!user) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
    }

    // Cek apakah user adalah writer
    if (user.role !== 'writer') {
      return res.status(400).json({ message: 'Pengguna bukan writer' });
    }

    // Cek apakah user sudah diverifikasi
    if (!user.is_verified) {
      return res.status(400).json({ message: 'Writer harus diverifikasi terlebih dahulu' });
    }

    // Update status persetujuan user
    await userService.updateUser(id, { is_approved: true });
    logger.info(`Writer ${id} has been approved`);

    // Kirim email notifikasi persetujuan
    await emailService.sendApprovalNotification(user.email);

    return res.status(200).json({
      message: 'Writer berhasil disetujui',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_verified: user.is_verified,
        is_approved: true
      }
    });
  } catch (error) {
    logger.error(`Error approving writer: ${error.message}`);
    return res.status(500).json({ message: 'Terjadi kesalahan saat menyetujui writer' });
  }
});

// Endpoint untuk menolak writer
router.post('/reject-writer/:id', authenticateJWT, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    logger.info(`Rejecting writer with ID: ${id}`);

    // Cek apakah user dengan ID tersebut ada
    const user = await userService.getUserById(id);
    if (!user) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
    }

    // Cek apakah user adalah writer
    if (user.role !== 'writer') {
      return res.status(400).json({ message: 'Pengguna bukan writer' });
    }

    // Update role user menjadi 'user' (bukan writer lagi)
    await userService.updateUser(id, { role: 'user', is_approved: 0 });
    logger.info(`Writer ${id} has been rejected and role changed to 'user'`);

    // Kirim email notifikasi penolakan
    await emailService.sendRejectionNotification(user.email);

    return res.status(200).json({
      message: 'Writer berhasil ditolak',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'user'
      }
    });
  } catch (error) {
    logger.error(`Error rejecting writer: ${error.message}`);
    return res.status(500).json({ message: 'Terjadi kesalahan saat menolak writer' });
  }
});

// Endpoint untuk mendapatkan daftar writer yang pending
router.get('/pending-writers', authenticateJWT, authorizeAdmin, async (req, res) => {
  try {
    logger.info('Fetching pending writers');

    // Dapatkan semua user dengan role writer yang belum diverifikasi atau belum disetujui
    const pendingWriters = await userService.getPendingWriters();

    return res.status(200).json(pendingWriters);
  } catch (error) {
    logger.error(`Error fetching pending writers: ${error.message}`);
    return res.status(500).json({ message: 'Terjadi kesalahan saat mengambil daftar writer pending' });
  }
});

// Endpoint untuk memverifikasi token
router.post('/verify-token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    // Gunakan fungsi verifyToken yang sudah diperbaiki
    const result = verifyToken(token);

    if (result.valid) {
      return res.status(200).json({ valid: true, user: result.decoded });
    } else {
      return res.status(401).json({ valid: false, message: result.error });
    }
  } catch (error) {
    logger.error(`Error verifying token: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Endpoint untuk mendapatkan profil user
router.get('/user-profile', authenticateJWT, async (req, res) => {
  try {
    await authController.getUserProfile(req, res);
  } catch (error) {
    logger.error(`Error getting user profile: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data profil'
    });
  }
});

// Endpoint untuk update profil user
router.post('/update-profile', authenticateJWT, upload.single('profile_picture'), async (req, res) => {
  console.log('Update profile request received:', { body: req.body, file: req.file });
  try {
    await authController.updateProfile(req, res);
  } catch (error) {
    logger.error(`Error updating profile: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui profil'
    });
  }
});

// Endpoint untuk mengubah password
router.post('/change-password', authenticateJWT, async (req, res) => {
  try {
    await authController.changePassword(req, res);
  } catch (error) {
    logger.error(`Error changing password: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengubah password'
    });
  }
});

module.exports = router;