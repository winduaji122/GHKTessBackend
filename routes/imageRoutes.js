const express = require('express');
const router = express.Router();
const { upload, handleMulterError } = require('../uploadConfig');
const imageController = require('../controllers/imageController');
const { isAuthenticated, isAdminOrWriter } = require('../middleware/authMiddleware');
const { logger } = require('../utils/logger');

/**
 * @route POST /api/images
 * @desc Upload dan proses gambar
 * @access Private (Admin, Writer)
 */
router.post('/',
  isAuthenticated,
  isAdminOrWriter,
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        return handleMulterError(err, req, res, next);
      }
      next();
    });
  },
  imageController.uploadImage
);

/**
 * @route GET /api/images/post/:postId
 * @desc Mendapatkan semua gambar untuk post tertentu
 * @access Public
 */
router.get('/post/:postId', imageController.getImagesByPostId);

/**
 * @route GET /api/images/:id/original
 * @desc Mendapatkan gambar asli berdasarkan ID
 * @access Public
 */
router.get('/:id/original', imageController.getOriginalImage);

/**
 * @route GET /api/images/:id/medium
 * @desc Mendapatkan gambar ukuran sedang berdasarkan ID
 * @access Public
 */
router.get('/:id/medium', imageController.getMediumImage);

/**
 * @route GET /api/images/:id/thumbnail
 * @desc Mendapatkan gambar thumbnail berdasarkan ID
 * @access Public
 */
router.get('/:id/thumbnail', imageController.getThumbnailImage);

/**
 * @route GET /api/images/:id
 * @desc Mendapatkan metadata gambar berdasarkan ID
 * @access Public
 */
router.get('/:id', imageController.getImageById);

/**
 * @route DELETE /api/images/:id
 * @desc Menghapus gambar berdasarkan ID
 * @access Private (Admin, Writer)
 */
router.delete('/:id',
  isAuthenticated,
  isAdminOrWriter,
  imageController.deleteImage
);

// Error handler
router.use((err, req, res, next) => {
  logger.error('Image route error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message
  });
});

module.exports = router;
