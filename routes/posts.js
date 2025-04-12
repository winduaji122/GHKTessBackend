const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { upload,handleMulterError } = require('../uploadConfig');
const path = require('path');

// Controllers & Models
const postController = require('../controllers/postController');
const uploadController = require('../controllers/uploadController');
const Post = require('../models/Post');
const User = require('../models/User');
const Label = require('../models/Label');
const PostLabel = require('../models/PostLabel');

// Middleware
const authMiddleware = require('../middleware/authMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { logger } = require('../utils/logger');

// Validation Middleware
const validatePost = [
  body('title').trim().isLength({ min: 3, max: 255 })
    .withMessage('Judul harus antara 3-255 karakter'),

  body('content').trim().notEmpty()
    .withMessage('Konten tidak boleh kosong'),

  // Validasi status dengan nilai default
  body('status')
    .isIn(['published', 'draft', 'archived', 'scheduled'])
    .withMessage('Status tidak valid')
    .default('draft'),

  // Validasi tanggal publikasi tanpa moment.js
  body('publish_date')
    .optional()
    .custom((value, { req }) => {
      if (!value && ['published', 'scheduled'].includes(req.body.status)) {
        throw new Error('Tanggal publikasi wajib diisi untuk status published/scheduled');
      }

      // Validasi format ISO date
      const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
      if (value && !dateRegex.test(value)) {
        throw new Error('Format tanggal harus ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ)');
      }

      // Validasi tanggal valid
      if (value) {
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          throw new Error('Tanggal tidak valid');
        }
      }

      return true;
    }),

  // Validasi labels yang lebih ketat
  body('labels')
    .optional()
    .isArray()
    .withMessage('Labels harus berupa array')
    .custom((value) => {
      if (value) {
        const isValid = value.every(label =>
          label && (
            (label.id && Number.isInteger(Number(label.id))) ||
            (label.label && typeof label.label === 'string')
          )
        );
        if (!isValid) throw new Error('Format label tidak valid');
      }
      return true;
    }),

  // Validasi boolean fields
  body('is_featured').optional().isBoolean().toBoolean(),
  body('is_spotlight').optional().isBoolean().toBoolean(),

  // Validasi image yang lebih lengkap
  body('image').custom((value, { req }) => {
    if (req.file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        throw new Error('Format file tidak didukung');
      }
      if (req.file.size > 5 * 1024 * 1024) {
        throw new Error('Ukuran file maksimal 5MB');
      }
    }
    return true;
  })
];

// 1. PUBLIC ROUTES (No Auth Required)
router.get('/', cacheMiddleware(300), postController.getAllPosts);
router.get('/featured', cacheMiddleware(300), postController.getFeaturedPosts);
router.get('/spotlight', cacheMiddleware(300, 'spotlight-posts'), postController.getSpotlightPosts);

// 2. PUBLIC ROUTES dengan parameter
router.get('/public/related/:id', postController.getRelatedPosts);
router.get('/public/id/:id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
  postController.getPublicPostById
);
router.get('/public/slug/:slug([^/]+)', (req, res, next) => {
  const { slug } = req.params;
  if (slug.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
    return res.redirect(`/api/posts/public/id/${slug}`);
  }
  next();
}, postController.getPublicPostBySlug);

// Endpoint untuk mendapatkan post berdasarkan nama label
router.get('/label/:labelSlug', (req, res, next) => {
  const { labelSlug } = req.params;

  // Jika labelSlug adalah '404' atau 'not-found', kembalikan 404 Not Found
  if (labelSlug === '404' || labelSlug === 'not-found') {
    return res.status(404).json({
      success: false,
      message: 'Label tidak ditemukan'
    });
  }

  // Jika labelSlug adalah ID (angka), redirect ke endpoint by-label-id
  if (!isNaN(parseInt(labelSlug)) && isFinite(labelSlug)) {
    return res.redirect(`/api/posts/by-label-id/${labelSlug}`);
  }
  next();
}, async (req, res) => {
  try {
    const { labelSlug } = req.params;
    const { page = 1, limit = 12 } = req.query;

    // Jika labelSlug adalah 'all', ambil semua post terbaru
    if (labelSlug === 'all') {
      const result = await Post.getAllPublishedPosts(parseInt(page), parseInt(limit));
      return res.json({
        success: true,
        posts: result.posts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: result.totalPages,
          totalItems: result.totalCount
        }
      });
    }

    // Cari label berdasarkan nama label (bukan slug)
    const connection = await require('../config/databaseConfig').getConnection();
    try {
      // Cari label berdasarkan nama label
      const [labelRows] = await connection.query(`
        SELECT * FROM unique_labels WHERE label = ?
      `, [labelSlug]);

      if (labelRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Label tidak ditemukan'
        });
      }

      const label = labelRows[0];

      // Ambil post berdasarkan label
      const result = await Post.getPostsByLabel(
        label.id,
        parseInt(page),
        parseInt(limit),
        'publish_date:desc'
      );

      res.json({
        success: true,
        posts: result.posts,
        label: label,
        pagination: {
          currentPage: parseInt(page),
          totalPages: result.totalPages,
          totalItems: result.totalCount
        }
      });
    } catch (error) {
      logger.error('Error fetching posts by label:', error);
      res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan saat mengambil post berdasarkan label',
        error: error.message
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error in GET /posts/label/:labelSlug:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil post berdasarkan label',
      error: error.message
    });
  }
});

// Endpoint untuk mendapatkan post berdasarkan slug label
router.get('/by-label-slug/:labelSlug', async (req, res) => {
  try {
    const { labelSlug } = req.params;
    const { page = 1, limit = 12 } = req.query;

    // Cari label berdasarkan nama label (karena tidak ada kolom slug)
    const connection = await require('../config/databaseConfig').getConnection();
    try {
      // Cari label berdasarkan nama label
      const [labelRows] = await connection.query(`
        SELECT * FROM unique_labels WHERE label = ?
      `, [labelSlug]);

      if (labelRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Label tidak ditemukan'
        });
      }

      const label = labelRows[0];

      // Ambil post berdasarkan label (hanya yang published)
      const result = await Post.getPostsByLabel(
        label.id,
        parseInt(page),
        parseInt(limit),
        'publish_date:desc',
        'published' // Tambahkan parameter status
      );

      res.json({
        success: true,
        posts: result.posts,
        label: label,
        pagination: {
          currentPage: parseInt(page),
          totalPages: result.totalPages,
          totalItems: result.totalCount
        }
      });
    } catch (error) {
      logger.error('Error fetching posts by label slug:', error);
      res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan saat mengambil post berdasarkan label',
        error: error.message
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error in GET /posts/by-label-slug/:labelSlug:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil post berdasarkan label',
      error: error.message
    });
  }
});

// Endpoint untuk mendapatkan post berdasarkan ID label
router.get('/by-label-id/:labelId', async (req, res) => {
  try {
    const { labelId } = req.params;
    const { page = 1, limit = 12 } = req.query;

    if (isNaN(parseInt(labelId))) {
      return res.status(400).json({
        success: false,
        message: 'Label ID harus berupa angka'
      });
    }

    // Ambil post berdasarkan ID label (hanya yang published)
    const result = await Post.getPostsByLabel(
      parseInt(labelId),
      parseInt(page),
      parseInt(limit),
      'publish_date:desc',
      'published' // Tambahkan parameter status
    );

    // Ambil informasi label
    const connection = await require('../config/databaseConfig').getConnection();
    try {
      const [labelRows] = await connection.query(`
        SELECT * FROM unique_labels WHERE id = ?
      `, [parseInt(labelId)]);

      const label = labelRows.length > 0 ? labelRows[0] : { label: `Label ${labelId}` };

      res.json({
        success: true,
        posts: result.posts,
        label: label,
        pagination: {
          currentPage: parseInt(page),
          totalPages: result.totalPages,
          totalItems: result.totalCount
        }
      });
    } catch (error) {
      logger.error('Error fetching label info:', error);
      res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan saat mengambil informasi label',
        error: error.message
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error in GET /posts/by-label-id/:labelId:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil post berdasarkan ID label',
      error: error.message
    });
  }
});

// 3. ADMIN ROUTES (Static/Non-Dynamic)
router.post('/',
  authMiddleware.isAuthenticated,
  upload.single('image'), // Middleware untuk upload gambar
  postController.createPost
);

router.get('/my-posts',
  authMiddleware.isAuthenticated,
  postController.getMyPosts
);

router.get('/my-deleted',
  authMiddleware.isAuthenticated,
  postController.getMyDeletedPosts
);

router.get('/deleted',
  authMiddleware.isAuthenticated,
  authMiddleware.isAdmin,
  postController.getDeletedPosts
);

router.get('/admin-featured',
  authMiddleware.isAuthenticated,
  authMiddleware.isAdmin,
  postController.getAdminFeaturedPost
);

// 4. SPECIAL ADMIN ROUTES (Static/Non-Dynamic)
router.put('/reset-featured',
  authMiddleware.isAuthenticated,
  authMiddleware.isAdmin,
  async (req, res, next) => {
    try {
      // Pastikan request body kosong atau valid
      if (req.body && Object.keys(req.body).length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Request body harus kosong'
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  },
  postController.resetFeatured
);

// 5. AUTHENTICATED ROUTES dengan parameter dinamis
router.get('/:id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
  authMiddleware.isAuthenticated,
  postController.getPostById
);

router.put('/:id',
  authMiddleware.isAuthenticated,
  authMiddleware.isAdminOrWriter,
  upload.single('image'),
  handleMulterError,
  validatePost,
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log('Update post request received for ID:', id);
      console.log('Request body:', req.body);
      console.log('Request file:', req.file);

      // Cari post yang akan diupdate menggunakan metode yang sesuai
      const postToUpdate = await Post.getFullPostById(id);

      if (!postToUpdate) {
        console.log('Post not found with ID:', id);
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }

      // Siapkan data untuk update
      const { title, content, status, publish_date, excerpt, is_featured, is_spotlight, slug } = req.body;

      const updateData = {
        title,
        content,
        status: status || postToUpdate.status,
        publish_date: publish_date || postToUpdate.publish_date,
        excerpt,
        is_featured: is_featured === '1' || is_featured === true ? 1 : 0,
        is_spotlight: is_spotlight === '1' || is_spotlight === true ? 1 : 0
      };

      // Handle slug
      if (slug) {
        // Jika slug adalah array, ambil elemen pertama
        if (Array.isArray(slug)) {
          updateData.slug = slug[0];
          console.log('Slug is an array, using first element:', updateData.slug);
        } else {
          updateData.slug = slug;
        }
      }

      // Tambahkan image jika ada
      if (req.file) {
        console.log('New image file received:', req.file.path);
        updateData.image = req.file.path.replace(/\\/g, '/').replace(/^.*\/uploads\//, 'uploads/');
        console.log('Image path formatted:', updateData.image);
      } else if (req.body.image) {
        console.log('Image path received from body:', req.body.image);

        // Jika image adalah [object Object], coba ekstrak path
        if (req.body.image === '[object Object]') {
          console.warn('Image is [object Object], cannot extract path');
          // Jangan update image, gunakan nilai yang sudah ada
        } else {
          updateData.image = req.body.image;
          console.log('Image path to be saved:', updateData.image);
        }
      }

      console.log('Post data to be updated:', updateData);

      // Update post menggunakan metode yang sesuai
      await Post.updatePost(id, updateData);
      console.log('Post updated with ID:', id);

      // Update labels jika ada
      if (req.body.labels) {
        try {
          let labelIds = [];

          // Coba parse labels sebagai JSON jika string
          if (typeof req.body.labels === 'string') {
            try {
              labelIds = JSON.parse(req.body.labels);
              console.log('Parsed labels from JSON string:', labelIds);
            } catch (e) {
              console.error('Error parsing labels JSON:', e);
              // Jika gagal parse, coba split string
              if (req.body.labels.includes(',')) {
                labelIds = req.body.labels.split(',').map(id => id.trim());
                console.log('Parsed labels from comma-separated string:', labelIds);
              } else {
                // Jika bukan JSON dan bukan comma-separated, gunakan sebagai single ID
                labelIds = [req.body.labels];
                console.log('Using labels as single ID:', labelIds);
              }
            }
          } else if (Array.isArray(req.body.labels)) {
            // Jika labels sudah berupa array
            labelIds = req.body.labels;
            console.log('Labels is already an array:', labelIds);
          }

          // Filter labelIds untuk memastikan hanya nilai valid
          labelIds = labelIds.filter(id => id && (typeof id === 'string' || typeof id === 'number'));

          if (labelIds.length > 0) {
            console.log('Setting labels for post:', labelIds);
            // Ganti postToUpdate.setLabels dengan metode yang sesuai
            await PostLabel.updatePostLabels(id, labelIds);
          }
        } catch (error) {
          console.error('Error setting labels:', error);
        }
      }

      // Ambil post yang sudah diupdate dengan labels
      const updatedPost = await Post.getFullPostById(id);

      return res.status(200).json({
        success: true,
        message: 'Post updated successfully',
        post: updatedPost
      });
    } catch (error) {
      console.error('Post route error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
);

// 6. SPECIAL ADMIN ROUTES dengan parameter dinamis
router.put('/:id/featured',
  authMiddleware.isAuthenticated,
  authMiddleware.isAdminOrWriter,
  async (req, res, next) => {
    try {
      // Normalisasi nilai is_featured
      const isFeatured = req.body.is_featured;

      // Konversi ke 1 atau 0
      req.body.is_featured = Boolean(isFeatured) ? 1 : 0;

      // Validasi input
      if (typeof req.body.is_featured !== 'number') {
        return res.status(400).json({
          success: false,
          message: 'Format is_featured tidak valid'
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  },
  postController.toggleFeatured
);

router.patch('/:id/toggle-spotlight',
  authMiddleware.isAuthenticated,
  postController.toggleSpotlight
);

router.delete('/:id',
  authMiddleware.isAuthenticated,
  authMiddleware.isAdminOrWriter,
  postController.deletePost
);

// Route untuk soft delete, restore, dan permanent delete
router.patch('/:id/soft-delete',
  authMiddleware.isAuthenticated,
  authMiddleware.isAdminOrWriter,
  postController.softDeletePost
);

router.patch('/:id/restore',
  authMiddleware.isAuthenticated,
  authMiddleware.isAdminOrWriter,
  postController.restorePost
);

router.delete('/:id/permanent',
  authMiddleware.isAuthenticated,
  authMiddleware.isAdminOrWriter,
  postController.deletePostPermanently
);

// 8. ERROR HANDLER
router.use((error, req, res, next) => {
  logger.error('Post route error:', {
    service: 'post-service',
    error: error.message,
    stack: error.stack,
    body: req.body,
    file: req.file
  });

  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File terlalu besar (max: 5MB)'
    });
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      message: 'Field tidak sesuai'
    });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validasi gagal',
      errors: error.errors
    });
  }

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: error.message
  });
});

module.exports = router;