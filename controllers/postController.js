const Post = require('../models/Post');
const PostLabel = require('../models/PostLabel');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const moment = require('moment');
const fs = require('fs').promises;
const sharp = require('sharp');
const { validatePostUpdate, handleValidationErrors } = require('../middleware/validationMiddleware');
const { isAdminOrWriter, isAdminOrAuthor } = require('../middleware/authMiddleware');
const { deleteFile } = require('../uploadConfig');
const { optimizeAndSaveImage, deleteImageFile, formatImageUrl } = require('../utils/imageHandler');
const { clearCache } = require('../utils/cacheHandler');
const db = require('../config/databaseConfig');
const { isAuthenticated } = require('../middleware/authMiddleware');

exports.getAllPosts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = 'all',
      label_id = null,
      sort = 'created_at:desc',
      featured = 'all',
      search = ''
    } = req.query;

    let whereConditions = [];
    let params = [];

    // Filter status
    if (status && status !== 'all') {
      whereConditions.push('p.status = ?');
      params.push(status);
    }

    // Filter label
    if (label_id) {
      whereConditions.push(`
        EXISTS (
          SELECT 1 FROM post_labels pl
          WHERE pl.post_id = p.id AND pl.label_id = ?
        )
      `);
      params.push(label_id);
    }

    // Filter featured/spotlight/regular
    if (featured === 'featured') {
      whereConditions.push('p.is_featured = 1');
    } else if (featured === 'spotlight') {
      whereConditions.push('p.is_spotlight = 1');
    } else if (featured === 'regular') {
      whereConditions.push('p.is_featured = 0 AND p.is_spotlight = 0');
    }

    // Search by keyword
    if (search) {
      whereConditions.push('(p.title LIKE ? OR p.content LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    // Handling different sort options
    let orderBy = '';
    switch(sort) {
      case 'created_at:desc':
        orderBy = 'p.created_at DESC';
        break;
      case 'created_at:asc':
        orderBy = 'p.created_at ASC';
        break;
      case 'views:desc':
        orderBy = 'p.views DESC';
        break;
      case 'title:asc':
        orderBy = 'p.title ASC';
        break;
      case 'title:desc':
        orderBy = 'p.title DESC';
        break;
      case 'label:asc':
        orderBy = 'MIN(ul.label) ASC';
        break;
      case 'label:desc':
        orderBy = 'MIN(ul.label) DESC';
        break;
      case 'is_featured:desc':
        orderBy = 'p.is_featured DESC, p.created_at DESC';
        break;
      default:
        orderBy = 'p.created_at DESC';
    }

    const query = `
      SELECT DISTINCT
        p.*,
        u.name as author_name,
        GROUP_CONCAT(
          DISTINCT JSON_OBJECT(
            'id', CAST(ul.id AS UNSIGNED),
            'label', ul.label
          )
        ) as labels
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN post_labels pl ON p.id = pl.post_id
      LEFT JOIN unique_labels ul ON pl.label_id = ul.id
      ${whereConditions.length ? 'WHERE ' + whereConditions.join(' AND ') : ''}
      GROUP BY p.id, u.name
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const queryParams = [...params, parseInt(limit), offset];

    // Count total records for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM posts p
      LEFT JOIN post_labels pl ON p.id = pl.post_id
      ${whereConditions.length ? 'WHERE ' + whereConditions.join(' AND ') : ''}
    `;

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      const [postsResult] = await connection.query(query, queryParams);
      const [count] = await connection.query(countQuery, params);

      res.json({
        success: true,
        data: postsResult.map(post => ({
          ...post,
          labels: post.labels ? JSON.parse(`[${post.labels}]`).filter(Boolean) : []
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count[0].total / parseInt(limit)),
          totalItems: count[0].total,
          limit: parseInt(limit)
        }
      });
    } catch (error) {
      logger.error('Database error in getAllPosts:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      // Pastikan koneksi selalu dilepas
      try {
        connection.release();
        logger.info('Connection released in getAllPosts');
      } catch (releaseError) {
        logger.error('Error releasing connection in getAllPosts:', releaseError);
      }
    }
  } catch (error) {
    logger.error('Error getting posts:', {
      error: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan dalam mengambil data posts',
      error: error.message
    });
  }
};

exports.getPostById = async (req, res) => {
  try {
    const { id } = req.params;

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      // Query untuk mendapatkan post dan informasi dasar
      const [rows] = await connection.query(`
        SELECT
          p.*,
          u.name as author_name,
          u.email as author_email
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.id = ?
      `, [id]);

      const post = rows[0];

      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post tidak ditemukan'
        });
      }

      // Query terpisah untuk mendapatkan label
      const [labelRows] = await connection.query(`
        SELECT ul.id, ul.label
        FROM post_labels pl
        JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE pl.post_id = ?
      `, [post.id]);

      // Format response dengan data yang diambil secara terpisah
      const formattedPost = {
        ...post,
        image: post.image ? formatImageUrl(post.image) : null,
        thumbnail: post.thumbnail ? formatImageUrl(post.thumbnail) : null,
        labels: labelRows || [],
        is_featured: Boolean(post.is_featured),
        is_spotlight: Boolean(post.is_spotlight),
        author: {
          name: post.author_name,
          email: post.author_email
        }
      };

      return res.json({
        success: true,
        data: formattedPost
      });
    } catch (error) {
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error dalam getPostById:', {
      error: error.message,
      stack: error.stack,
      id: req.params.id
    });

    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan dalam mengambil data post',
      error: error.message
    });
  }
};

// Fungsi untuk memformat path gambar
const formatImagePath = (path) => {
  if (!path) return '';

  // Jika path sudah mengandung 'uploads/', gunakan apa adanya
  if (path.includes('uploads/')) {
    return path;
  }

  // Jika path adalah nama file saja, tambahkan 'uploads/'
  return `uploads/${path.replace(/\\/g, '/')}`;
};

exports.createPost = async (req, res) => {
  try {
    console.log('Create post request received');
    console.log('Request body:', req.body);
    console.log('Request file:', req.file);
    console.log('User role:', req.user.role);

    // Dapatkan data dari request
    const { title, content, status, publish_date, excerpt, is_featured, is_spotlight, labels } = req.body;

    // Validasi data
    if (!title || !content) {
      console.log('Validation failed: title or content missing');
      return res.status(400).json({
        success: false,
        message: 'Title and content are required'
      });
    }

    // Siapkan data post dengan penyesuaian berdasarkan role
    const postData = {
      title,
      content,
      user_id: req.user.id,
      publish_date: publish_date || new Date(),
      excerpt: excerpt || generateExcerpt(content)
    };

    // Penyesuaian berdasarkan role
    if (req.user.role === 'admin') {
      // Admin dapat mengatur semua properti
      postData.status = status || 'published';
      postData.is_featured = is_featured === '1' || is_featured === true ? 1 : 0;
      postData.is_spotlight = is_spotlight === '1' || is_spotlight === true ? 1 : 0;
    } else if (req.user.role === 'writer') {
      // Writer hanya bisa membuat post dengan status draft
      postData.status = 'draft';
      postData.is_featured = 0; // Writer tidak bisa set featured
      postData.is_spotlight = 0; // Writer tidak bisa set spotlight

      console.log('Writer restrictions applied: status=draft, featured=0, spotlight=0');
    } else {
      // Role tidak dikenal
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Invalid role'
      });
    }

    // Tambahkan image jika ada
    if (req.file) {
      console.log('Image file received:', req.file.path);
      postData.image = formatImagePath(req.file.path);
      console.log('Image path formatted:', postData.image);
    } else if (req.body.image) {
      console.log('Image path received from body:', req.body.image);
      postData.image = formatImagePath(req.body.image);
      console.log('Image path formatted:', postData.image);
    } else {
      console.log('No image received');
      postData.image = ''; // Set default empty string
    }

    // Tambahkan labels jika ada
    if (labels) {
      try {
        let labelIds = [];

        // Coba parse labels sebagai JSON jika string
        if (typeof labels === 'string') {
          try {
            labelIds = JSON.parse(labels);
            console.log('Parsed labels from JSON string:', labelIds);
          } catch (e) {
            console.error('Error parsing labels JSON:', e);
            // Jika gagal parse, coba split string
            if (labels.includes(',')) {
              labelIds = labels.split(',').map(id => id.trim());
              console.log('Parsed labels from comma-separated string:', labelIds);
            } else {
              // Jika bukan JSON dan bukan comma-separated, gunakan sebagai single ID
              labelIds = [labels];
              console.log('Using labels as single ID:', labelIds);
            }
          }
        } else if (Array.isArray(labels)) {
          // Jika labels sudah berupa array
          labelIds = labels;
          console.log('Labels is already an array:', labelIds);
        }

        // Filter labelIds untuk memastikan hanya nilai valid
        labelIds = labelIds.filter(id => id && (typeof id === 'string' || typeof id === 'number'));

        if (labelIds.length > 0) {
          console.log('Adding labels to postData:', labelIds);
          postData.labels = labelIds;
        }
      } catch (error) {
        console.error('Error processing labels:', error);
      }
    }

    console.log('Post data to be saved:', postData);

    // Buat post baru menggunakan metode createPost
    const createdPost = await Post.createPost(postData);
    console.log('Post created with ID:', createdPost.id);

    return res.status(201).json({
      success: true,
      message: 'Post created successfully',
      post: createdPost
    });
  } catch (error) {
    console.error('Error creating post:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Helper functions
const generateExcerpt = (content, maxLength = 500) => {
  if (!content) return '';
  // Hapus HTML tags
  const plainText = content.replace(/<[^>]*>/g, '');
  // Potong teks dan tambahkan ellipsis jika terlalu panjang
  return plainText.length > maxLength
    ? plainText.slice(0, maxLength) + '...'
    : plainText;
};

const generateSlug = (title) => {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// Fungsi untuk menghasilkan slug unik
const generateUniqueSlug = async (title) => {
  const baseSlug = generateSlug(title);
  if (!baseSlug) return uuidv4();

  let slug = baseSlug;
  let counter = 1;
  let isUnique = false;

  const connection = await db.getConnection();
  try {
    while (!isUnique) {
      const [rows] = await connection.query(
        'SELECT COUNT(*) as count FROM posts WHERE slug = ?',
        [slug]
      );

      if (rows[0].count === 0) {
        isUnique = true;
      } else {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
    }

    return slug;
  } finally {
    connection.release();
  }
};

// Tambahkan fungsi formatPostResponse jika belum ada
const formatPostResponse = (post) => {
  if (!post) return null;

  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    content: post.content,
    excerpt: post.excerpt,
    status: post.status,
    publish_date: post.publish_date,
    created_at: post.created_at,
    updated_at: post.updated_at,
    image: post.image,
    author_id: post.author_id,
    author_name: post.author_name,
    is_featured: post.is_featured === 1 || post.is_featured === true,
    is_spotlight: post.is_spotlight === 1 || post.is_spotlight === true,
    labels: Array.isArray(post.labels) ? post.labels : [],
    views: post.views || 0,
    comments_count: post.comments_count || 0
  };
};

exports.updatePost = async (req, res) => {
  try {
    console.log('Update post request received');
    console.log('Request params:', req.params);
    console.log('Request body:', req.body);
    console.log('Request file:', req.file);
    console.log('User role:', req.user.role);

    const { id } = req.params;
    const { title, content, status, publish_date, excerpt, is_featured, is_spotlight, labels } = req.body;

    // Cari post yang akan diupdate
    const post = await Post.findByPk(id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Validasi akses
    if (post.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this post'
      });
    }

    // Siapkan data untuk update dengan penyesuaian berdasarkan role
    const updateData = {
      title: title || post.title,
      content: content || post.content,
      excerpt: excerpt !== undefined ? excerpt : post.excerpt
    };

    // Penyesuaian berdasarkan role
    if (req.user.role === 'admin') {
      // Admin dapat mengubah semua properti
      updateData.status = status || post.status;
      updateData.is_featured = is_featured === '1' || is_featured === true ? 1 : 0;
      updateData.is_spotlight = is_spotlight === '1' || is_spotlight === true ? 1 : 0;

      // Update publish_date jika ada
      if (publish_date) {
        updateData.publish_date = publish_date;
      }
    } else if (req.user.role === 'writer') {
      // Writer hanya bisa mengubah konten, tidak bisa mengubah status atau fitur khusus
      console.log('Writer restrictions applied: cannot change status, featured, or spotlight');

      // Writer hanya bisa mengubah publish_date jika post masih draft
      if (publish_date && post.status === 'draft') {
        updateData.publish_date = publish_date;
      }
    }

    // Tambahkan image jika ada
    if (req.file) {
      console.log('Image file received:', req.file.path);
      updateData.image = formatImagePath(req.file.path);
      console.log('Image path formatted:', updateData.image);
    } else if (req.body.image) {
      console.log('Image path received from body:', req.body.image);
      updateData.image = formatImagePath(req.body.image);
      console.log('Image path formatted:', updateData.image);
    }

    console.log('Post data to be updated:', updateData);

    // Update post
    await post.update(updateData);
    console.log('Post updated with ID:', post.id);

    // Update labels jika ada
    if (labels) {
      try {
        let labelIds = [];

        // Coba parse labels sebagai JSON jika string
        if (typeof labels === 'string') {
          try {
            labelIds = JSON.parse(labels);
            console.log('Parsed labels from JSON string:', labelIds);
          } catch (e) {
            console.error('Error parsing labels JSON:', e);
            // Jika gagal parse, coba split string
            if (labels.includes(',')) {
              labelIds = labels.split(',').map(id => id.trim());
              console.log('Parsed labels from comma-separated string:', labelIds);
            } else {
              // Jika bukan JSON dan bukan comma-separated, gunakan sebagai single ID
              labelIds = [labels];
              console.log('Using labels as single ID:', labelIds);
            }
          }
        } else if (Array.isArray(labels)) {
          // Jika labels sudah berupa array
          labelIds = labels;
          console.log('Labels is already an array:', labelIds);
        }

        // Filter labelIds untuk memastikan hanya nilai valid
        labelIds = labelIds.filter(id => id && (typeof id === 'string' || typeof id === 'number'));

        if (labelIds.length > 0) {
          console.log('Setting labels for post:', labelIds);
          await post.setLabels(labelIds);
        }
      } catch (error) {
        console.error('Error setting labels:', error);
      }
    }

    // Ambil post yang sudah diupdate dengan labels
    const updatedPost = await Post.findByPk(post.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name'] },
        { model: Label, as: 'labels', through: { attributes: [] } }
      ]
    });

    return res.status(200).json({
      success: true,
      message: 'Post updated successfully',
      post: updatedPost
    });
  } catch (error) {
    console.error('Error updating post:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

exports.deletePost = [isAdminOrWriter, async (req, res) => {
  try {
    const { id } = req.params;

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Cek apakah post ada dan user berhak menghapusnya
      const [posts] = await connection.query(`
        SELECT * FROM posts
        WHERE id = ? AND deleted_at IS NULL
      `, [id]);

      if (!posts.length) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: 'Post tidak ditemukan'
        });
      }

      const post = posts[0];

      // Validasi berdasarkan role
      if (req.user.role !== 'admin' && post.author_id !== req.user.id) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: 'Anda tidak berhak menghapus post ini'
        });
      }

      // Jika writer, hanya bisa menghapus post draft
      if (req.user.role === 'writer' && post.status !== 'draft' && post.author_id === req.user.id) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: 'Writer hanya dapat menghapus post dengan status draft'
        });
      }

      // Soft delete dengan mengupdate deleted_at
      await connection.query(`
        UPDATE posts
        SET deleted_at = NOW(),
            status = 'archived'
        WHERE id = ?
      `, [id]);

      await connection.commit();

      res.json({
        success: true,
        message: 'Post berhasil dihapus'
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error deleting post:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Gagal menghapus post'
    });
  }
}];

exports.getFeaturedPosts = async (req, res) => {
  try {
    logger.info('Fetching featured posts');
    const limit = parseInt(req.query.limit) || 10;
    const isAdmin = req.query.admin === 'true';

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      // Query untuk mengambil featured posts
      let query = `
        SELECT
          p.*,
          u.name as author_name,
          u.email as author_email
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.is_featured = 1
          AND p.deleted_at IS NULL
      `;

      // Jika bukan admin, tambahkan filter status published
      if (!isAdmin) {
        query += ` AND p.status = 'published'`;
      }

      query += ` ORDER BY p.created_at DESC LIMIT ?`;

      const [posts] = await connection.query(query, [limit]);

      // Log untuk debugging
      logger.info(`Found ${posts.length} featured posts with IDs: ${posts.map(p => p.id).join(', ')}`);

      // Jika tidak ada featured posts
      if (posts.length === 0) {
        return res.json({
          success: true,
          data: [],
          message: 'No featured posts found'
        });
      }

      // Ambil label untuk semua post yang ditemukan
      const formattedPosts = [];

      for (const post of posts) {
        // Query terpisah untuk mendapatkan label
        const [labelRows] = await connection.query(`
          SELECT ul.id, ul.label
          FROM post_labels pl
          JOIN unique_labels ul ON pl.label_id = ul.id
          WHERE pl.post_id = ?
        `, [post.id]);

        formattedPosts.push({
          ...post,
          image: post.image ? formatImageUrl(post.image) : null,
          thumbnail: post.thumbnail ? formatImageUrl(post.thumbnail) : null,
          labels: labelRows || [],
          is_featured: Boolean(post.is_featured),
          is_spotlight: Boolean(post.is_spotlight),
          author: {
            name: post.author_name,
            email: post.author_email
          }
        });
      }

      // Jika ada featured post
      if (posts.length > 0) {
        logger.info(`Featured post details: ID=${posts[0].id}, Title="${posts[0].title}", Status=${posts[0].status}`);
      }

      return res.json({
        success: true,
        data: formattedPosts,
        message: 'Featured posts retrieved successfully'
      });
    } catch (error) {
      logger.error('Database error in getFeaturedPosts:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error fetching featured posts:', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Error fetching featured posts',
      error: error.message
    });
  }
};

exports.getSpotlightPosts = async (req, res) => {
  let connection;
  try {
    logger.info('Fetching spotlight posts');

    // Gunakan koneksi langsung dari db
    connection = await db.getConnection();

    // Query untuk mengambil spotlight posts - gunakan query yang lebih sederhana
    const [posts] = await connection.query(`
      SELECT
        p.id, p.title, p.slug, p.content, p.image, p.status,
        p.created_at, p.updated_at, p.is_featured, p.is_spotlight,
        u.name as author_name,
        u.email as author_email
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      WHERE p.is_spotlight = 1
        AND p.deleted_at IS NULL
        AND p.status = 'published'
      ORDER BY p.created_at DESC
      LIMIT 6
    `);

    // Ambil label secara terpisah untuk mengurangi kompleksitas query
    const postIds = posts.map(post => post.id);
    let labels = [];

    if (postIds.length > 0) {
      const [labelRows] = await connection.query(`
        SELECT pl.post_id, ul.id, ul.label
        FROM post_labels pl
        JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE pl.post_id IN (?)
      `, [postIds]);

      labels = labelRows;
    }

    // Format response
    const formattedPosts = posts.map(post => {
      const postLabels = labels
        .filter(label => label.post_id === post.id)
        .map(label => ({ id: label.id, label: label.label }));

      return {
        ...post,
        is_spotlight: Boolean(post.is_spotlight),
        is_featured: Boolean(post.is_featured),
        labels: postLabels || []
      };
    });

    res.json({
      success: true,
      data: formattedPosts,
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalItems: formattedPosts.length
      }
    });
  } catch (error) {
    logger.error('Error fetching spotlight posts:', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan dalam mengambil spotlight posts',
      error: error.message
    });
  } finally {
    // Pastikan koneksi selalu dilepas
    if (connection) {
      try {
        connection.release();
      } catch (releaseError) {
        logger.error('Error releasing connection:', releaseError);
      }
    }
  }
};

exports.toggleFeatured = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_featured } = req.body;
    const userId = req.user.id;

    // Validasi input
    if (typeof is_featured !== 'number' || (is_featured !== 0 && is_featured !== 1)) {
      return res.status(400).json({
        success: false,
        message: 'Nilai is_featured harus 0 atau 1'
      });
    }

    // Handle new post creation
    if (!id || id === 'new') {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const newPost = {
          title: 'Draft Post',
          content: '',
          author_id: userId,
          is_featured,
          status: 'draft',
          version: 1
        };

        const [insertResult] = await connection.query(
          'INSERT INTO posts SET ?',
          [newPost]
        );

        const postId = insertResult.insertId;

        const [posts] = await connection.query(
          'SELECT id, is_featured, author_id FROM posts WHERE id = ?',
          [postId]
        );

        await connection.commit();

        return res.json({
          success: true,
          message: 'Post baru berhasil dibuat',
          post: posts[0]
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    // Handle existing post update
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Lakukan UPDATE terlebih dahulu
      const [updateResult] = await connection.query(
        `UPDATE posts
         SET is_featured = ?, version = version + 1, updated_at = NOW()
         WHERE id = ?`,
        [is_featured, id]
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          message: 'Post tidak ditemukan'
        });
      }

      // 2. Kemudian lakukan SELECT untuk mendapatkan data yang diperbarui
      const [posts] = await connection.query(
        'SELECT id, is_featured, author_id, title FROM posts WHERE id = ?',
        [id]
      );

      if (posts.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          message: 'Post tidak ditemukan setelah update'
        });
      }

      // 3. Jika is_featured = 1, reset post lain
      if (is_featured === 1) {
        await connection.query(
          'UPDATE posts SET is_featured = 0 WHERE id != ? AND is_featured = 1',
          [id]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: `Post berhasil ${is_featured === 1 ? 'dijadikan' : 'dihapus dari'} featured`,
        post: posts[0]
      });
    } catch (error) {
      await connection.rollback();
      logger.error('Error in toggleFeatured transaction:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error in toggleFeatured:', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Gagal mengubah status featured post',
      error: error.message
    });
  }
};

exports.resetFeatured = async (req, res) => {
  try {
    logger.info('=== Reset Featured Posts Process Started ===');

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Reset semua post featured menjadi false
      const [result] = await connection.query(
        'UPDATE posts SET is_featured = 0 WHERE is_featured = 1'
      );

      await connection.commit();

      logger.info('Featured posts reset successfully:', {
        affectedRows: result.affectedRows
      });

      res.json({
        success: true,
        message: 'Featured posts berhasil direset',
        affectedRows: result.affectedRows
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error resetting featured posts:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mereset featured posts'
    });
  }
};

// Helper function untuk normalisasi boolean
const normalizeBoolean = (value) => {
  // Log untuk debugging
  console.log('Normalizing boolean value:', {
    original: value,
    type: typeof value
  });

  // Jika sudah boolean
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  // Jika number
  if (typeof value === 'number') {
    return value === 1 ? 1 : 0;
  }

  // Jika string
  if (typeof value === 'string') {
    const normalized = ['1', 'true', 'yes'].includes(value.toLowerCase()) ? 1 : 0;
    console.log('Normalized string value:', {
      original: value,
      normalized
    });
    return normalized;
  }

  // Default ke false
  return 0;
};

exports.toggleSpotlight = [isAdminOrWriter, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_spotlight } = req.body;

    logger.info('Toggle spotlight request:', {
      postId: id,
      requestBody: req.body,
      is_spotlight: is_spotlight
    });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Cek post
      const [posts] = await connection.query(
        'SELECT id, title, is_spotlight, version FROM posts WHERE id = ? AND deleted_at IS NULL',
        [id]
      );

      if (!posts.length) {
        await connection.rollback();
        throw new Error('Post tidak ditemukan');
      }

      // Normalisasi nilai is_spotlight ke 0/1
      const spotlightValue = is_spotlight === true ||
                           is_spotlight === 1 ||
                           is_spotlight === '1' ? 1 : 0;

      // Update status spotlight
      await connection.query(
        `UPDATE posts
         SET is_spotlight = ?,
             updated_at = CURRENT_TIMESTAMP,
             version = version + 1
         WHERE id = ?`,
        [spotlightValue, id]
      );

      // Ambil data terbaru
      const [updatedPosts] = await connection.query(
        'SELECT id, is_spotlight, version, updated_at FROM posts WHERE id = ?',
        [id]
      );

      await connection.commit();

      // Clear cache jika ada
      if (typeof clearCache === 'function') {
        await clearCache('spotlight-posts');
      }

      res.json({
        success: true,
        message: `Post berhasil ${spotlightValue ? 'ditambahkan ke' : 'dihapus dari'} spotlight`,
        data: {
          id,
          is_spotlight: Boolean(spotlightValue),
          version: updatedPosts[0].version,
          updated_at: updatedPosts[0].updated_at
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error toggling spotlight status:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Gagal mengubah status spotlight'
    });
  }
}];

// Query untuk mengambil related posts
exports.getRelatedPosts = async (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 4;

    // Query untuk mendapatkan related posts dengan format tanggal yang benar
    const [relatedPosts] = await connection.query(`
      SELECT
        p.id,
        p.title,
        p.slug,
        p.excerpt,
        p.image,
        DATE_FORMAT(p.created_at, '%Y-%m-%dT%H:%i:%s.000Z') as created_at,
        DATE_FORMAT(p.publish_date, '%Y-%m-%dT%H:%i:%s.000Z') as publish_date,
        GROUP_CONCAT(DISTINCT l.name) as labels
      FROM posts p
      LEFT JOIN post_labels pl ON p.id = pl.post_id
      LEFT JOIN labels l ON pl.label_id = l.id
      WHERE p.id != ?
        AND p.status = 'published'
        AND p.deleted_at IS NULL
      GROUP BY p.id, p.title, p.slug, p.excerpt, p.image, p.created_at, p.publish_date
      ORDER BY COALESCE(p.publish_date, p.created_at) DESC
      LIMIT ?
    `, [id, limit]);

    // Format posts
    const formattedPosts = relatedPosts.map(post => ({
      id: post.id,
      title: post.title,
      slug: post.slug,
      image: post.image ? formatImageUrl(post.image) : null,
      publish_date: post.publish_date,
      created_at: post.created_at,
      excerpt: post.excerpt,
      labels: post.labels ? post.labels.split(',').filter(Boolean) : []
    }));

    // Debug log
    console.log('Formatted posts with dates:', formattedPosts);

    res.json({
      success: true,
      data: formattedPosts
    });

  } catch (error) {
    console.error('Error getting related posts:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil related posts'
    });
  }
};



exports.getPostBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    logger.info(`Mencoba mengambil post dengan slug: ${slug}`);
    const post = await Post.findBySlugOrId(slug);

    if (!post) {
      logger.warn(`Post tidak ditemukan untuk slug: ${slug}`);
      return res.status(404).json({ message: 'Post tidak ditemukan' });
    }

    logger.info(`Post berhasil ditemukan untuk slug: ${slug}, id: ${post.id}`);
    res.json(post);
  } catch (error) {
    logger.error(`Error saat mengambil post dengan slug: ${req.params.slug}`, error);
    res.status(500).json({ message: 'Error fetching post', error: error.message });
  }
};

exports.getMyPosts = [isAdminOrWriter, async (req, res) => {
  try {
    const authorId = req.user.id;
    const {
      page = 1,
      limit = 10,
      includeLabels = true,
      search = '',
      dateFrom = '',
      dateTo = '',
      labelId = ''
    } = req.query;

    // Konversi parameter ke boolean
    const shouldIncludeLabels = includeLabels === 'true' || includeLabels === true;

    // Log untuk debugging
    logger.info('Fetching my posts with params:', {
      authorId,
      page: parseInt(page),
      limit: parseInt(limit),
      includeLabels: shouldIncludeLabels,
      search,
      dateFrom,
      dateTo,
      labelId
    });

    // Buat objek options untuk parameter tambahan
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      includeLabels: shouldIncludeLabels,
      search: search || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      labelId: labelId || undefined
    };

    // Panggil metode dengan parameter options
    const result = await Post.getPostsByAuthor(authorId, options);

    // Log hasil untuk debugging
    logger.debug('Posts fetched successfully', {
      postCount: result.posts.length,
      firstPost: result.posts.length > 0 ? {
        id: result.posts[0].id,
        title: result.posts[0].title,
        hasLabels: result.posts[0].labels && result.posts[0].labels.length > 0
      } : null
    });

    res.json({
      posts: result.posts,
      currentPage: parseInt(options.page),
      totalPages: result.totalPages,
      totalCount: result.totalCount
    });
  } catch (error) {
    logger.error('Error fetching my posts:', error);
    res.status(500).json({ message: 'Error fetching my posts', error: error.message });
  }
}];

exports.getPostsByAuthor = [isAdminOrWriter, async (req, res) => {
  try {
    let authorId;
    const { page = 1, limit = 10 } = req.query;

    if (req.user.role === 'writer') {
      authorId = req.user.id;
    } else {
      authorId = req.params.authorId || req.query.authorId;
    }

    if (!authorId) {
      return res.status(400).json({ message: 'Author ID diperlukan' });
    }

    const result = await Post.getPostsByAuthor(authorId, parseInt(page), parseInt(limit));

    res.json({
      posts: result.posts,
      currentPage: parseInt(page),
      totalPages: result.totalPages,
      totalCount: result.totalCount
    });
  } catch (error) {
    logger.error('Error fetching posts by author:', error);
    res.status(500).json({ message: 'Error fetching posts by author', error: error.message });
  }
}];

exports.incrementViews = async (req, res) => {
  try {
    const { id } = req.params;
    const ip = req.ip;

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      // Cek apakah sudah ada view dari IP ini dalam 24 jam terakhir
      const [existingViews] = await connection.query(
        `SELECT id FROM post_views
         WHERE post_id = ? AND viewer_ip = ?
         AND viewed_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
        [id, ip]
      );

      if (existingViews.length === 0) {
        // Insert view baru jika belum ada view dalam 24 jam
        await connection.query(
          'INSERT INTO post_views (id, post_id, viewer_ip) VALUES (UUID(), ?, ?)',
          [id, ip]
        );
      }

      res.json({ message: 'View count updated successfully' });
    } catch (error) {
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error incrementing views:', error);
    res.status(500).json({
      message: 'Terjadi kesalahan saat mengupdate view count',
      error: error.message
    });
  }
};

exports.getPostVersions = [isAdminOrAuthor, async (req, res) => {
  try {
    const { id } = req.params;
    const versions = await Post.getVersions(id);
    res.json(versions);
  } catch (error) {
    logger.error('Error fetching post versions:', error);
    res.status(500).json({ message: 'Error fetching post versions', error: error.message });
  }
}];

exports.previewPost = [isAdminOrWriter, async (req, res) => {
  try {
    const { title, content, image } = req.body;
    res.json({ title, content, image });
  } catch (error) {
    logger.error('Error previewing post:', error);
    res.status(500).json({ message: 'Error previewing post', error: error.message });
  }
}];

exports.getPostAnalytics = [isAdminOrAuthor, async (req, res) => {
  try {
    const { id } = req.params;
    const analytics = await Post.getAnalytics(id);
    res.json(analytics);
  } catch (error) {
    logger.error('Error fetching post analytics:', error);
    res.status(500).json({ message: 'Error fetching post analytics', error: error.message });
  }
}];

exports.getPosts = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  try {
    const {
      status = 'published',
      label_id = null,
      sort = 'created_at:desc',
      deleted = false,
    } = req.query;

    let whereConditions = [];
    let params = [];

    // Filter status
    if (status && status !== 'published') {
      whereConditions.push('p.status = ?');
      params.push(status);
    }

    // Filter deleted
    if (deleted && deleted !== 'false') {
      whereConditions.push('p.deleted_at IS NOT NULL');
      params.push(deleted);
    }

    // Filter label - Perbaiki kondisi WHERE
    if (label_id) {
      whereConditions.push('EXISTS (SELECT 1 FROM post_labels pl WHERE pl.post_id = p.id AND pl.label_id = ?)');
      params.push(label_id);
    }

    // Query utama yang diperbaiki
    const query = `
      SELECT DISTINCT
        p.*,
        u.name as author_name,
        GROUP_CONCAT(
          DISTINCT JSON_OBJECT(
            'id', ul.id,
            'label', ul.label
          )
        ) as labels
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN post_labels pl ON p.id = pl.post_id
      LEFT JOIN unique_labels ul ON pl.label_id = ul.id
      ${whereConditions.length ? 'WHERE ' + whereConditions.join(' AND ') : ''}
      GROUP BY p.id, u.name
      ORDER BY ${sort.replace(':', ' ')}
      LIMIT ? OFFSET ?
    `;

    // Query count yang diperbaiki
    const countQuery = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM posts p
      ${whereConditions.length ? 'WHERE ' + whereConditions.join(' AND ') : ''}
    `;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const queryParams = [...params, parseInt(limit), offset];
    const countParams = [...params]; // Params untuk count query tidak perlu limit & offset

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      // Eksekusi query dengan parameter yang benar
      const [postsResult] = await connection.query(query, queryParams);
      const [countRows] = await connection.query(countQuery, countParams);

      console.log('Pagination info:', {
        page,
        limit,
        offset: (page - 1) * limit,
        totalItems: countRows[0].total,
        totalPages: Math.ceil(countRows[0].total / limit)
      });

      // Format response
      res.json({
        success: true,
        data: postsResult.map(post => ({
          ...post,
          labels: post.labels ? JSON.parse(`[${post.labels}]`).filter(Boolean) : []
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(countRows[0].total / parseInt(limit)),
          totalItems: countRows[0].total,
          limit: parseInt(limit)
        }
      });
    } catch (error) {
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error getting posts:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan dalam mengambil data posts',
      error: error.message
    });
  }
};

// Controller untuk soft delete post
exports.softDeletePost = async (req, res) => {
  try {
    const { id } = req.params;

    // Gunakan metode yang benar untuk soft delete
    const updatedPost = await Post.softDeletePost(id);

    if (!updatedPost) {
      return res.status(404).json({
        success: false,
        message: 'Post tidak ditemukan'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Post berhasil di-soft delete',
      post: updatedPost
    });
  } catch (error) {
    console.error('Error soft deleting post:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: error.message
    });
  }
};

// Controller untuk restore post
exports.restorePost = async (req, res) => {
  try {
    const { id } = req.params;

    // Gunakan metode yang benar untuk restore
    const restoredPost = await Post.restorePost(id);

    if (!restoredPost) {
      return res.status(404).json({
        success: false,
        message: 'Post tidak ditemukan'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Post berhasil dipulihkan',
      post: restoredPost
    });
  } catch (error) {
    console.error('Error restoring post:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: error.message
    });
  }
};

// Controller untuk permanent delete
exports.deletePostPermanently = async (req, res) => {
  try {
    const { id } = req.params;

    // Gunakan metode yang benar untuk permanent delete
    const result = await Post.deletePostPermanently(id);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Post tidak ditemukan atau gagal menghapus'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Post berhasil dihapus secara permanen'
    });
  } catch (error) {
    console.error('Error permanently deleting post:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: error.message
    });
  }
};

// Controller untuk mendapatkan deleted posts
exports.getDeletedPosts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const result = await Post.getDeletedPosts(page, limit);

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Error getting deleted posts:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: error.message
    });
  }
};

exports.getPublicPostBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    logger.info(`Mencoba mengambil public post dengan slug: ${slug}`);

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      // Query untuk mendapatkan post dan informasi dasar
      const [rows] = await connection.query(`
        SELECT
          p.*,
          u.name as author_name,
          u.email as author_email
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.slug = ?
          AND p.status = 'published'
          AND p.deleted_at IS NULL
      `, [slug]);

      const post = rows[0];

      if (!post) {
        logger.warn(`Post tidak ditemukan dengan slug: ${slug}`);
        return res.status(404).json({
          success: false,
          message: 'Post tidak ditemukan'
        });
      }

      // Query terpisah untuk mendapatkan label
      const [labelRows] = await connection.query(`
        SELECT ul.id, ul.label
        FROM post_labels pl
        JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE pl.post_id = ?
      `, [post.id]);

      // Ambil related posts berdasarkan kesamaan label
      let relatedPosts = [];
      try {
        // Jika post memiliki label, cari post lain dengan label yang sama
        if (labelRows.length > 0) {
          // Ekstrak ID label
          const labelIds = labelRows.map(label => label.id);

          // Pendekatan baru: Gunakan GROUP BY alih-alih DISTINCT
          const [relatedRows] = await connection.query(`
            SELECT
              p.id, p.title, p.slug, p.excerpt, p.image
            FROM posts p
            JOIN post_labels pl ON p.id = pl.post_id
            WHERE pl.label_id IN (?)
              AND p.id != ?
              AND p.status = 'published'
              AND p.deleted_at IS NULL
            GROUP BY p.id, p.title, p.slug, p.excerpt, p.image
            ORDER BY p.created_at DESC
            LIMIT 5
          `, [labelIds, post.id]);

          relatedPosts = relatedRows.map(rp => ({
            ...rp,
            image: rp.image ? formatImageUrl(rp.image) : null
          }));
        } else {
          // Jika tidak ada label, ambil post terbaru sebagai related
          const [recentRows] = await connection.query(`
            SELECT
              p.id, p.title, p.slug, p.excerpt, p.image
            FROM posts p
            WHERE p.id != ?
              AND p.status = 'published'
              AND p.deleted_at IS NULL
            ORDER BY p.created_at DESC
            LIMIT 5
          `, [post.id]);

          relatedPosts = recentRows.map(rp => ({
            ...rp,
            image: rp.image ? formatImageUrl(rp.image) : null
          }));
        }
      } catch (relatedError) {
        logger.error('Error fetching related posts:', {
          error: relatedError.message,
          postId: post.id
        });
        // Tetap gunakan array kosong jika terjadi error
      }

      // Format response dengan data yang diambil secara terpisah
      const formattedPost = {
        id: post.id,
        title: post.title || '',
        content: post.content || '',
        image: post.image ? formatImageUrl(post.image) : null,
        thumbnail: post.thumbnail ? formatImageUrl(post.thumbnail) : null,
        created_at: post.created_at,
        updated_at: post.updated_at,
        version: post.version || 1,
        is_featured: Boolean(post.is_featured),
        publish_date: post.publish_date,
        views: parseInt(post.views || 0),
        is_spotlight: Boolean(post.is_spotlight),
        status: post.status,
        slug: post.slug,
        excerpt: post.excerpt || '',
        labels: labelRows || [],
        author: {
          name: post.author_name,
          email: post.author_email
        },
        related_posts: relatedPosts
      };

      return res.json({
        success: true,
        data: formattedPost
      });
    } catch (error) {
      logger.error('Database error in getPublicPostBySlug:', {
        error: error.message,
        stack: error.stack,
        slug
      });
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error dalam getPublicPostBySlug:', {
      error: error.message,
      stack: error.stack,
      slug: req.params.slug
    });

    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan dalam mengambil data post',
      error: error.message
    });
  }
};

exports.getPublicPostById = async (req, res) => {
  try {
    const { id } = req.params;
    logger.info(`Mencoba mengambil public post dengan ID: ${id}`);

    // Validasi ID
    if (!id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Format ID tidak valid'
      });
    }

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      // Query untuk mendapatkan post dan informasi dasar
      const [rows] = await connection.query(`
        SELECT
          p.*,
          u.name as author_name,
          u.email as author_email
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.id = ?
          AND p.status = 'published'
          AND p.deleted_at IS NULL
      `, [id]);

      const post = rows[0];

      if (!post) {
        logger.warn(`Post tidak ditemukan dengan ID: ${id}`);
        return res.status(404).json({
          success: false,
          message: 'Post tidak ditemukan'
        });
      }

      // Query terpisah untuk mendapatkan label
      const [labelRows] = await connection.query(`
        SELECT ul.id, ul.label
        FROM post_labels pl
        JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE pl.post_id = ?
      `, [post.id]);

      // Ambil related posts berdasarkan kesamaan label
      let relatedPosts = [];
      try {
        // Jika post memiliki label, cari post lain dengan label yang sama
        if (labelRows.length > 0) {
          // Ekstrak ID label
          const labelIds = labelRows.map(label => label.id);

          // Pendekatan baru: Gunakan GROUP BY alih-alih DISTINCT
          const [relatedRows] = await connection.query(`
            SELECT
              p.id, p.title, p.slug, p.excerpt, p.image
            FROM posts p
            JOIN post_labels pl ON p.id = pl.post_id
            WHERE pl.label_id IN (?)
              AND p.id != ?
              AND p.status = 'published'
              AND p.deleted_at IS NULL
            GROUP BY p.id, p.title, p.slug, p.excerpt, p.image
            ORDER BY p.created_at DESC
            LIMIT 5
          `, [labelIds, post.id]);

          relatedPosts = relatedRows.map(rp => ({
            ...rp,
            image: rp.image ? formatImageUrl(rp.image) : null
          }));
        } else {
          // Jika tidak ada label, ambil post terbaru sebagai related
          const [recentRows] = await connection.query(`
            SELECT
              p.id, p.title, p.slug, p.excerpt, p.image
            FROM posts p
            WHERE p.id != ?
              AND p.status = 'published'
              AND p.deleted_at IS NULL
            ORDER BY p.created_at DESC
            LIMIT 5
          `, [post.id]);

          relatedPosts = recentRows.map(rp => ({
            ...rp,
            image: rp.image ? formatImageUrl(rp.image) : null
          }));
        }
      } catch (relatedError) {
        logger.error('Error fetching related posts:', {
          error: relatedError.message,
          postId: post.id
        });
        // Tetap gunakan array kosong jika terjadi error
      }

      // Format response dengan data yang diambil secara terpisah
      const formattedPost = {
        ...post,
        image: post.image ? formatImageUrl(post.image) : null,
        thumbnail: post.thumbnail ? formatImageUrl(post.thumbnail) : null,
        labels: labelRows || [],
        is_featured: Boolean(post.is_featured),
        is_spotlight: Boolean(post.is_spotlight),
        author: {
          name: post.author_name,
          email: post.author_email
        },
        related_posts: relatedPosts
      };

      return res.json({
        success: true,
        data: formattedPost
      });
    } catch (error) {
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error dalam getPublicPostById:', {
      error: error.message,
      stack: error.stack,
      id: req.params.id
    });

    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan dalam mengambil data post',
      error: error.message
    });
  }
};

// Tambahkan controller untuk admin featured post
exports.getAdminFeaturedPost = async (req, res) => {
  try {
    logger.info('Fetching admin featured post');

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      // Ubah query untuk mencocokkan dengan getFeaturedPosts
      // Hapus filter status untuk admin agar bisa melihat semua post yang featured
      const [posts] = await connection.query(`
        SELECT
          p.*,
          u.name as author_name,
          u.email as author_email
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.is_featured = 1
          AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
        LIMIT 1
      `);

      // Log untuk debugging
      logger.info(`Found ${posts.length} admin featured posts with IDs: ${posts.map(p => p.id).join(', ')}`);

      // Jika tidak ada featured post
      if (posts.length === 0) {
        logger.info('No featured posts found');
        return res.json({
          success: true,
          data: null,
          message: 'No featured post found'
        });
      }

      const post = posts[0];
      logger.info(`Featured post details: ID=${post.id}, Title="${post.title}", Status=${post.status}`);

      // Query terpisah untuk mendapatkan label
      const [labelRows] = await connection.query(`
        SELECT ul.id, ul.label
        FROM post_labels pl
        JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE pl.post_id = ?
      `, [post.id]);

      const formattedPost = {
        ...post,
        image: post.image ? formatImageUrl(post.image) : null,
        thumbnail: post.thumbnail ? formatImageUrl(post.thumbnail) : null,
        labels: labelRows || [],
        is_featured: Boolean(post.is_featured),
        is_spotlight: Boolean(post.is_spotlight),
        author: {
          name: post.author_name,
          email: post.author_email
        }
      };

      // Selaraskan format respons dengan getFeaturedPosts
      return res.json({
        success: true,
        data: [formattedPost], // Kembalikan sebagai array untuk konsistensi
        message: 'Admin featured post retrieved successfully'
      });
    } catch (error) {
      logger.error('Database error in getAdminFeaturedPost:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error fetching admin featured post:', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Error fetching admin featured post',
      error: error.message
    });
  }
};

// Tambahkan endpoint debugging untuk memeriksa featured post
exports.debugFeaturedPosts = async (req, res) => {
  try {
    logger.info('Debugging featured posts');

    const connection = await db.getConnection();
    try {
      // Query untuk memeriksa semua post yang di-featured
      const [posts] = await connection.query(`
        SELECT
          id, title, status, is_featured, created_at, updated_at, author_id
        FROM posts
        WHERE is_featured = 1
        ORDER BY created_at DESC
      `);

      logger.info(`Found ${posts.length} featured posts`);

      return res.json({
        success: true,
        data: posts,
        message: 'Debug featured posts'
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error debugging featured posts:', error);
    res.status(500).json({
      success: false,
      message: 'Error debugging featured posts',
      error: error.message
    });
  }
};

// Perbaiki fungsi getMyDeletedPosts untuk menggunakan model Post.getDeletedPostsByUserId
exports.getMyDeletedPosts = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const includeLabels = req.query.include_labels === 'true';

    logger.info(`Fetching deleted posts for user ${userId}, page ${page}, limit ${limit}, search: "${search}", includeLabels: ${includeLabels}`, { service: "user-service" });

    // Gunakan model Post.getDeletedPostsByUserId dengan options object
    const options = {
      page,
      limit,
      search,
      includeLabels
    };

    const result = await Post.getDeletedPostsByUserId(userId, options);

    logger.info(`Found ${result.posts.length} deleted posts for user ${userId}`, { service: "user-service" });

    return res.status(200).json({
      success: true,
      data: result.posts,
      pagination: result.pagination
    });
  } catch (error) {
    logger.error('Error getting deleted posts:', {
      service: "user-service",
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: error.message
    });
  }
};
