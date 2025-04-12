const express = require('express');
const router = express.Router();
const { logger } = require('../utils/logger');
const { isAuthenticated } = require('../middleware/authMiddleware');
const rateLimiter = require('../utils/rateLimiter');
const { validateSearch } = require('../middleware/validationMiddleware');
const { redis, executeQuery } = require('../config/databaseConfig');
const { search } = require('../controllers/searchController');
const { getAllLabels } = require('../controllers/labelController');
// Tambahkan import csrf
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: true });
const jwt = require('jsonwebtoken');

// Rute pencarian umum
router.get('/', rateLimiter, validateSearch, search);

// Rute untuk saran pencarian
router.get('/suggestions', rateLimiter, validateSearch, async (req, res) => {
  const { q } = req.query;
  const cacheKey = `suggestions:${q}`;

  try {
    // Cek cache terlebih dahulu
    const cachedSuggestions = await redis.get(cacheKey);
    if (cachedSuggestions) {
      return res.json(JSON.parse(cachedSuggestions));
    }

    const suggestions = await executeQuery(async (connection) => {
      const [postSuggestions] = await connection.query(
        'SELECT title FROM posts WHERE title LIKE ? LIMIT 5',
        [`%${q}%`]
      );
      const [labelSuggestions] = await connection.query(
        'SELECT label FROM unique_labels WHERE label LIKE ? LIMIT 5',
        [`%${q}%`]
      );
      return {
        posts: postSuggestions.map(post => post.title),
        labels: labelSuggestions.map(label => label.label)
      };
    });

    // Simpan saran ke cache
    await redis.set(cacheKey, JSON.stringify(suggestions), 'EX', 1800); // Cache selama 30 menit

    res.json(suggestions);
  } catch (error) {
    logger.error('Error in search suggestions:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil saran pencarian.' });
  }
});

// Route untuk advanced search
router.get('/advanced', async (req, res) => {
  try {
    const { q = '', page = 1, limit = 10, status, label_id, featured, sort } = req.query;
    
    logger.info('Advanced search request:', { 
      service: 'user-service',
      query: q,
      status,
      label_id,
      featured,
      sort,
      page,
      limit
    });

    const results = await executeQuery(async (connection) => {
      let sql = `
        SELECT p.*, 
          GROUP_CONCAT(CONCAT(ul.id, ':', ul.label)) AS labels
        FROM posts p
        LEFT JOIN post_labels pl ON p.id = pl.post_id
        LEFT JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE 1=1
      `;
      
      const params = [];

      if (q) {
        sql += ` AND (p.title LIKE ? OR p.content LIKE ?)`;
        params.push(`%${q}%`, `%${q}%`);
      }

      if (label_id) {
        sql += ` AND pl.label_id = ?`;
        params.push(label_id);
      }

      if (status && status !== 'all') {
        sql += ` AND p.status = ?`;
        params.push(status);
      }

      if (featured && featured !== 'all') {
        sql += ` AND p.is_featured = ?`;
        params.push(featured === 'featured' ? 1 : 0);
      }

      sql += ` GROUP BY p.id`;

      // Handle sorting
      switch(sort) {
        case 'title:asc':
          sql += ` ORDER BY p.title ASC`;
          break;
        case 'title:desc':
          sql += ` ORDER BY p.title DESC`;
          break;
        default:
          sql += ` ORDER BY p.created_at DESC`;
      }

      sql += ` LIMIT ? OFFSET ?`;
      params.push(Number(limit), (Number(page) - 1) * Number(limit));

      const [rows] = await connection.query(sql, params);
      return rows;
    });

    res.json({
      success: true,
      data: results,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(results.length / limit),
        totalItems: results.length
      }
    });

  } catch (error) {
    logger.error('Error in advanced search:', error);
    res.status(500).json({ 
      success: false,
      message: 'Terjadi kesalahan dalam pencarian',
      error: error.message 
    });
  }
});

// Endpoint publik untuk labels
router.get('/labels', async (req, res) => {
  try {
    const labels = await executeQuery(async (connection) => {
      const query = `
        SELECT id, label as name 
        FROM unique_labels 
        ORDER BY label ASC
      `;
      
      const [rows] = await connection.query(query);
      return rows;
    });

    res.json(labels);
  } catch (error) {
    logger.error('Error fetching labels:', error);
    res.status(500).json({ 
      message: 'Terjadi kesalahan saat mengambil label',
      error: error.message 
    });
  }
});

module.exports = router;
