/**
 * Routes untuk database gambar
 * Menyediakan endpoint untuk mendapatkan metadata gambar
 */

const express = require('express');
const router = express.Router();
const { executeQuery } = require('../config/databaseConfig');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { logger } = require('../utils/logger');

/**
 * @route GET /api/images/database
 * @desc Mendapatkan database gambar
 * @access Public
 */
router.get('/database', async (req, res) => {
  try {
    // Ambil semua gambar dari database
    const [images] = await executeQuery(
      `SELECT id, original_path, medium_path, thumbnail_path, 
              mime_type, width, height, size, post_id
       FROM images 
       ORDER BY created_at DESC 
       LIMIT 1000`
    );

    // Format response
    const formattedImages = images.map(image => ({
      id: image.id,
      original_path: image.original_path,
      medium_path: image.medium_path,
      thumbnail_path: image.thumbnail_path,
      mime_type: image.mime_type,
      width: image.width,
      height: image.height,
      size: image.size,
      post_id: image.post_id
    }));

    // Buat URL lengkap
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    return res.status(200).json({
      success: true,
      message: 'Database gambar berhasil diambil',
      images: formattedImages,
      baseUrl
    });
  } catch (error) {
    logger.error('Error getting image database:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil database gambar',
      error: error.message
    });
  }
});

/**
 * @route GET /api/images/by-post/:postId
 * @desc Mendapatkan gambar berdasarkan post ID
 * @access Public
 */
router.get('/by-post/:postId', async (req, res) => {
  try {
    const { postId } = req.params;

    // Ambil gambar dari database
    const [images] = await executeQuery(
      `SELECT id, original_path, medium_path, thumbnail_path, 
              mime_type, width, height, size
       FROM images 
       WHERE post_id = ?
       ORDER BY created_at DESC`,
      [postId]
    );

    // Format response
    const formattedImages = images.map(image => ({
      id: image.id,
      original_path: image.original_path,
      medium_path: image.medium_path,
      thumbnail_path: image.thumbnail_path,
      mime_type: image.mime_type,
      width: image.width,
      height: image.height,
      size: image.size
    }));

    // Buat URL lengkap
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    return res.status(200).json({
      success: true,
      message: 'Gambar berhasil diambil',
      images: formattedImages,
      baseUrl
    });
  } catch (error) {
    logger.error(`Error getting images for post ${req.params.postId}:`, error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil gambar',
      error: error.message
    });
  }
});

/**
 * @route GET /api/images/:id/metadata
 * @desc Mendapatkan metadata gambar berdasarkan ID
 * @access Public
 */
router.get('/:id/metadata', async (req, res) => {
  try {
    const { id } = req.params;

    // Ambil gambar dari database
    const [images] = await executeQuery(
      `SELECT id, original_path, medium_path, thumbnail_path, 
              mime_type, width, height, size, post_id
       FROM images 
       WHERE id = ?`,
      [id]
    );

    if (images.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Gambar tidak ditemukan'
      });
    }

    const image = images[0];

    // Buat URL lengkap
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    return res.status(200).json({
      success: true,
      message: 'Metadata gambar berhasil diambil',
      data: {
        id: image.id,
        urls: {
          original: `${baseUrl}/${image.original_path}`,
          medium: `${baseUrl}/${image.medium_path}`,
          thumbnail: `${baseUrl}/${image.thumbnail_path}`
        },
        mime_type: image.mime_type,
        width: image.width,
        height: image.height,
        size: image.size,
        post_id: image.post_id
      }
    });
  } catch (error) {
    logger.error(`Error getting metadata for image ${req.params.id}:`, error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil metadata gambar',
      error: error.message
    });
  }
});

module.exports = router;
