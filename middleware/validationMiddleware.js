// middleware/validationMiddleware.js
const { body, validationResult, check } = require('express-validator');
const { slugAlreadyExists } = require('../utils/slugUtils');
const { logger } = require('../utils/logger');

// Fungsi helper untuk menangani hasil validasi
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.info('Validation errors:', errors.array());
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Validasi untuk registrasi
exports.validateRegistration = [
  body('username').trim().isLength({ min: 3 }).withMessage('Username harus minimal 3 karakter'),
  body('email').isEmail().withMessage('Email tidak valid'),
  body('password').isLength({ min: 6 }).withMessage('Password harus minimal 6 karakter'),
  body('name').trim().notEmpty().withMessage('Nama tidak boleh kosong'),
  handleValidationErrors
];

// Validasi untuk login
exports.validateLogin = [
  body('email').trim().isEmail().normalizeEmail().withMessage('Email tidak valid'),
  body('password').notEmpty().withMessage('Password tidak boleh kosong'),
  handleValidationErrors
];

// Validasi untuk pembaruan profil
exports.validateProfileUpdate = [
  body('name').optional().trim().notEmpty().withMessage('Nama tidak boleh kosong'),
  body('email').optional().isEmail().withMessage('Email tidak valid'),
  handleValidationErrors
];

// Validasi untuk pencarian
exports.validateSearch = [
  check('q')
    .trim()
    .notEmpty().withMessage('Query pencarian tidak boleh kosong')
    .isLength({ min: 2 }).withMessage('Query pencarian harus minimal 2 karakter'),
  check('type')
    .optional()
    .isIn(['posts', 'labels', 'users']).withMessage('Tipe pencarian tidak valid'),
  handleValidationErrors
];

// Validasi untuk pembuatan post
exports.validatePostCreation = [
  (req, res, next) => {
    logger.info('Received data:', req.body);
    logger.info('Received files:', req.files);
    next();
  },
  check('title').trim().notEmpty().withMessage('Judul post tidak boleh kosong'),
  check('content').trim().notEmpty().withMessage('Konten post tidak boleh kosong'),
  check('publish_date').optional().isISO8601().toDate().withMessage('Format tanggal publikasi tidak valid'),
  check('is_featured').optional().isBoolean().withMessage('is_featured harus berupa boolean'),
  check('is_spotlight').optional().isBoolean().withMessage('is_spotlight harus berupa boolean'),
  check('slug')
  .optional()
  .isSlug().withMessage('Slug harus berupa string tanpa spasi dan karakter khusus')
  .custom(async (value) => {
    if (value && await slugAlreadyExists(value)) {
      throw new Error('Slug sudah digunakan');
    }
    return true;
  }),
  check('excerpt')
  .optional()
  .isLength({ max: 500 }).withMessage('Excerpt tidak boleh lebih dari 500 karakter'),
  
  check('labels')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        try {
          JSON.parse(value);
          return true;
        } catch (e) {
          throw new Error('Labels harus berupa array yang valid');
        }
      } else if (Array.isArray(value)) {
        return true;
      }
      throw new Error('Labels harus berupa array');
    }),
  check('status')
    .optional()
    .isIn(['published', 'draft', 'archived'])
    .withMessage('Status harus salah satu dari: published, draft, atau archived'),
  handleValidationErrors
];

// Validasi untuk pembaruan post
exports.validatePostUpdate = [
  check('title').optional().notEmpty().withMessage('Judul tidak boleh kosong'),
  check('content').optional().notEmpty().withMessage('Konten tidak boleh kosong'),
  check('publish_date').optional().isISO8601().toDate().withMessage('Format tanggal publikasi tidak valid'),
  check('is_featured').optional().isBoolean().withMessage('is_featured harus berupa boolean'),
  check('is_spotlight').optional().isBoolean().withMessage('is_spotlight harus berupa boolean'),
  check('excerpt')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Excerpt tidak boleh lebih dari 500 karakter'),
  check('slug')
    .optional()
    .isSlug()
    .withMessage('Slug harus berupa string tanpa spasi dan karakter khusus')
    .custom(async (value, { req }) => {
      const postId = req.params.id; // Asumsikan ID post ada di params
      if (await slugAlreadyExists(value, postId)) {
        throw new Error('Slug sudah digunakan');
      }
      return true;
    }),
  check('labels')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        try {
          JSON.parse(value);
          return true;
        } catch (e) {
          throw new Error('Labels harus berupa array yang valid');
        }
      } else if (Array.isArray(value)) {
        return true;
      }
      throw new Error('Labels harus berupa array');
    }),
  check('status')
    .optional()
    .isIn(['published', 'draft', 'archived'])
    .withMessage('Status harus salah satu dari: published, draft, atau archived'),
];

// Validasi untuk pembuatan label
exports.validateLabelCreation = [
  body('name').trim().isLength({ min: 2 }).withMessage('Nama label harus minimal 2 karakter'),
  handleValidationErrors
];

// Validasi untuk pembaruan role pengguna oleh admin
exports.validateUserRoleUpdate = [
  body('role').isIn(['admin', 'writer', 'user']).withMessage('Role tidak valid'),
  handleValidationErrors
];

// Middleware untuk memastikan pengguna adalah admin
exports.isAdmin = (req, res, next) => {
  if (req.user && req.user.is_admin) {
    next();
  } else {
    res.status(403).json({ message: 'Akses ditolak. Hanya admin yang diizinkan.' });
  }
};

// Tambahkan validasi untuk reset password
exports.validatePasswordReset = [
  body('token').notEmpty().withMessage('Token reset password diperlukan'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('Password baru harus minimal 6 karakter')
    .matches(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).{8,}$/)
    .withMessage('Password harus mengandung setidaknya satu huruf besar, satu huruf kecil, satu angka, dan satu karakter khusus'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Konfirmasi password tidak cocok');
      }
      return true;
    }),
  handleValidationErrors
];

// Tambahkan validasi untuk permintaan reset password
exports.validateForgotPassword = [
  body('email').isEmail().withMessage('Email tidak valid'),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  validateRegistration: exports.validateRegistration,
  validateLogin: exports.validateLogin,
  validateProfileUpdate: exports.validateProfileUpdate,
  validatePostCreation: exports.validatePostCreation,
  validatePostUpdate: exports.validatePostUpdate,
  validateLabelCreation: exports.validateLabelCreation,
  validateUserRoleUpdate: exports.validateUserRoleUpdate,
  validatePasswordReset: exports.validatePasswordReset,
  validateForgotPassword: exports.validateForgotPassword,
  validateSearch: exports.validateSearch,
  isAdmin: exports.isAdmin
};
