// backend/config/databaseConfig.js
const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// MySQL configuration
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: process.env.NODE_ENV === 'production' ? 5 : 15, // Lebih sedikit koneksi di production untuk serverless
  idleTimeout: process.env.NODE_ENV === 'production' ? 30000 : 60000, // Timeout lebih cepat di production
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

// Tambahkan SSL jika diperlukan
if (process.env.DB_SSL === 'true') {
  dbConfig.ssl = {
    rejectUnauthorized: true
  };
}

const pool = mysql.createPool(dbConfig);

pool.on('acquire', function (connection) {
  logger.info(`Connection ${connection.threadId} acquired`);
});

pool.on('release', function (connection) {
  logger.info(`Connection ${connection.threadId} released`);
});

pool.on('enqueue', function () {
  logger.warn('Waiting for available connection slot');
});

// Redis configuration - conditionally create based on environment
let redis;
let inMemoryCache = {};

if (process.env.REDIS_ENABLED !== 'false') {
  try {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      maxRetriesPerRequest: null,
      commandTimeout: 5000,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

    redis.on('error', (err) => {
      logger.error('Redis error:', err);
    });
  } catch (error) {
    logger.error('Failed to initialize Redis:', error);
    // Fallback to in-memory cache if Redis initialization fails
    redis = null;
  }
}

// If Redis is disabled or failed to initialize, use in-memory cache
if (!redis) {
  logger.info('Redis disabled, using in-memory cache');
  const memoryCache = inMemoryCache;
  redis = {
    setex: async (key, expires, value) => {
      memoryCache[key] = {
        value,
        expires: Date.now() + (expires * 1000)
      };
      return 'OK';
    },
    get: async (key) => {
      const item = memoryCache[key];
      if (!item) return null;
      if (item.expires < Date.now()) {
        delete memoryCache[key];
        return null;
      }
      return item.value;
    },
    del: async (key) => {
      delete memoryCache[key];
      return 1;
    },
    keys: async (pattern) => {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return Object.keys(memoryCache).filter(key => regex.test(key));
    },
    quit: async () => {
      return 'OK';
    },
    ping: async () => {
      return 'PONG';
    }
  };
}

// Cache management functions
const cacheKeys = {
  SPOTLIGHT_POSTS: 'spotlight_posts',
  FEATURED_POSTS: 'featured_posts',
  POST_DETAIL: (id) => `post_${id}`,
  ALL_POSTS: (params) => `all_posts_${JSON.stringify(params)}`
};

// MySQL functions
async function getConnection() {
  return await pool.getConnection();
}

const executeQuery = async (queryOrCallback, params = []) => {
  let connection;
  try {
    connection = await pool.getConnection();
    logger.info('MySQL connection ' + connection.threadId + ' acquired', { service: 'user-service' });
    logger.info('Connection acquired', { service: 'user-service' });

    // Jika queryOrCallback adalah fungsi, jalankan dengan connection
    if (typeof queryOrCallback === 'function') {
      return await queryOrCallback(connection);
    }

    // Jika queryOrCallback adalah string (query SQL)
    const [results] = await connection.query(queryOrCallback, params);
    return results;

  } catch (error) {
    logger.error('Database error:', error, { service: 'user-service' });
    throw error;
  } finally {
    if (connection) {
      logger.info('MySQL connection ' + connection.threadId + ' released', { service: 'user-service' });
      logger.info('Connection released', { service: 'user-service' });
      connection.release();
    }
  }
};

async function getAllPosts(page = 1, limit = 10, isFeatured = false, isSpotlight = false) {
  return executeQuery(async (connection) => {
    let query = 'SELECT * FROM posts';
    const conditions = [];
    if (isFeatured) {
      conditions.push('is_featured = 1');
    }
    if (isSpotlight) {
      conditions.push('is_spotlight = 1');
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY publish_date DESC LIMIT ? OFFSET ?';

    const offset = (page - 1) * limit;
    const [rows] = await connection.query(query, [limit, offset]);

    const [countResult] = await connection.query('SELECT COUNT(*) as total FROM posts' + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : ''));
    const totalCount = countResult[0].total;

    return {
      posts: rows,
      totalCount: totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit)
    };
  });
}

async function getPostWithLabels(postId) {
  return executeQuery(async (connection) => {
    const [rows] = await connection.query(`
      SELECT p.*, GROUP_CONCAT(CAST(ul.id AS CHAR)) AS label_ids,
             GROUP_CONCAT(ul.label) AS label_names
      FROM posts p
      LEFT JOIN post_labels pl ON p.id = pl.post_id
      LEFT JOIN unique_labels ul ON pl.label_id = ul.id
      WHERE p.id = ?
      GROUP BY p.id
    `, [postId]);

    if (rows[0]) {
      rows[0].labels = rows[0].label_ids ? rows[0].label_ids.split(',').map((id, index) => ({
        id: parseInt(id),
        label: rows[0].label_names.split(',')[index]
      })) : [];
      delete rows[0].label_ids;
      delete rows[0].label_names;
    }

    return rows[0];
  });
}

async function getSpotlightPosts(limit = 5) {
  const cacheKey = cacheKeys.SPOTLIGHT_POSTS;

  try {
    // Coba ambil dari cache
    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      logger.info('Returning spotlight posts from cache');
      return cachedData;
    }

    // Jika tidak ada di cache, ambil dari database
    const result = await executeQuery(async (connection) => {
      const [rows] = await connection.query(`
        SELECT p.*,
               u.name as author_name,
               u.email as author_email,
               GROUP_CONCAT(
                 JSON_OBJECT(
                   'id', l.id,
                   'label', l.label
                 )
               ) as labels
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN post_labels pl ON p.id = pl.post_id
        LEFT JOIN unique_labels l ON pl.label_id = l.id
        WHERE p.is_spotlight = 1
        AND p.deleted_at IS NULL
        AND p.status = 'published'
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT ?
      `, [limit]);

      const formattedPosts = rows.map(post => ({
        ...post,
        is_spotlight: Boolean(post.is_spotlight),
        is_featured: Boolean(post.is_featured),
        labels: post.labels ? JSON.parse(`[${post.labels}]`) : []
      }));

      return formattedPosts;
    });

    // Simpan ke cache
    await setCache(cacheKey, result);

    return result;
  } catch (error) {
    logger.error('Error in getSpotlightPosts:', error);
    throw error;
  }
}

async function addNewPost(post, labels, userId) {
  return executeQuery(async (connection) => {
    await connection.beginTransaction();
    try {
      const postId = uuidv4();
      const [result] = await connection.query(`
        INSERT INTO posts (id, title, content, image, author_id, is_spotlight, status, slug, excerpt, created_at, updated_at, version, is_featured, publish_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?)
      `, [postId, post.title, post.content, post.image, userId, post.is_spotlight || 0, post.status || 'draft', post.slug, post.excerpt, 1, post.is_featured || 0, post.publish_date]);

      if (labels && labels.length > 0) {
        const labelValues = labels.map(labelId => [
          postId,
          parseInt(labelId)
        ]).filter(([_, labelId]) => !isNaN(labelId));

        if (labelValues.length > 0) {
          await connection.query(
            'INSERT INTO post_labels (post_id, label_id) VALUES ?',
            [labelValues]
          );
        }
      }

      await savePostVersion(postId, post.content);

      await connection.commit();
      logger.info('New post saved:', postId);
      return postId;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

async function updatePost(postId, post, labels, userId) {
  return executeQuery(async (connection) => {
    await connection.beginTransaction();
    try {
      const [currentPost] = await connection.query('SELECT version FROM posts WHERE id = ?', [postId]);
      const newVersion = currentPost[0].version + 1;

      await connection.query(`
        UPDATE posts
        SET title = ?, content = ?, image = ?, is_spotlight = ?, status = ?, slug = ?, excerpt = ?,
            updated_at = NOW(), version = ?, is_featured = ?, publish_date = ?
        WHERE id = ? AND author_id = ?
      `, [post.title, post.content, post.image, post.is_spotlight, post.status, post.slug, post.excerpt,
          newVersion, post.is_featured, post.publish_date, postId, userId]);

      await connection.query('DELETE FROM post_labels WHERE post_id = ?', [postId]);

      if (labels && labels.length > 0) {
        const labelValues = labels.map(labelId => [
          postId,
          parseInt(labelId)
        ]).filter(([_, labelId]) => !isNaN(labelId));

        if (labelValues.length > 0) {
          await connection.query(
            'INSERT INTO post_labels (post_id, label_id) VALUES ?',
            [labelValues]
          );
        }
      }

      await savePostVersion(postId, post.content);

      await Promise.all([
        deleteCache(cacheKeys.POST_DETAIL(postId)),
        clearCachePattern('spotlight_posts*'),
        clearCachePattern('featured_posts*'),
        clearCachePattern('all_posts*')
      ]);

      await connection.commit();
      logger.info('Post updated:', postId);
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

async function addLabelToPost(postId, labelId) {
  return executeQuery(async (connection) => {
    const numericLabelId = parseInt(labelId);
    if (isNaN(numericLabelId)) {
      throw new Error('Label ID harus berupa number');
    }

    const [result] = await connection.query(
      'INSERT INTO post_labels (post_id, label_id) VALUES (?, ?)',
      [postId, numericLabelId]
    );
    return { success: true, message: 'Label berhasil ditambahkan ke post' };
  });
}

async function removeLabelFromPost(postId, labelId) {
  return executeQuery(async (connection) => {
    const [result] = await connection.query('DELETE FROM post_labels WHERE post_id = ? AND label_id = ?', [postId, labelId]);
    return result.affectedRows > 0;
  });
}

async function getAllLabels() {
  return executeQuery(async (connection) => {
    const [rows] = await connection.query('SELECT * FROM unique_labels ORDER BY id');
    return rows.map(row => ({
      ...row,
      id: parseInt(row.id)
    }));
  });
}

async function getFeaturedPosts(limit = 5) {
  return executeQuery(async (connection) => {
    const [rows] = await connection.query('SELECT * FROM posts WHERE is_featured = 1 ORDER BY publish_date DESC LIMIT ?', [limit]);
    return rows;
  });
}

// Test connections
async function testConnections() {
  try {
    // Test MySQL
    const connection = await pool.getConnection();
    await connection.query('SELECT 1');
    logger.info('MySQL connection successful');
    connection.release();

    // Test Redis
    await redis.ping();
    logger.info('Redis connection successful');
  } catch (error) {
    logger.error('Error testing connections:', error.message);
    throw error;
  }
}

// Run connection tests when the application starts
testConnections();

// Event listeners for MySQL pool
pool.on('connection', (connection) => logger.info('New MySQL connection established'));
pool.on('acquire', (connection) => logger.info('MySQL connection %d acquired', connection.threadId));
pool.on('release', (connection) => logger.info('MySQL connection %d released', connection.threadId));
pool.on('error', (err) => {
  logger.error('Unexpected error on idle MySQL client', err);
  testConnections();
});

function validateEnv() {
  // Variabel lingkungan yang selalu diperlukan
  const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

  // Tambahkan variabel Redis jika Redis diaktifkan
  if (process.env.REDIS_ENABLED !== 'false') {
    requiredEnvVars.push('REDIS_HOST', 'REDIS_PORT');
  }

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      logger.error(`Error: Environment variable ${envVar} is not set.`);
      // Di Vercel, jangan exit process karena akan menyebabkan deployment gagal
      if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
      } else {
        logger.error(`Running without ${envVar} in production mode. This may cause issues.`);
      }
    }
  }
}

validateEnv();

// Fungsi untuk user
async function createUser(userData) {
  return executeQuery(async (connection) => {
    const { username, email, password, name, role = 'pending', google_id = null } = userData;
    const [result] = await connection.query(
      'INSERT INTO users (id, username, email, password, name, role, google_id, is_approved, is_verified) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)',
      [username, email, password, name, role, google_id, 0, 0]
    );
    return result.insertId;
  });
}

async function getUserByEmail(email) {
  return executeQuery(async (connection) => {
    const [rows] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0];
  });
}

async function updateUserRole(userId, role, isApproved) {
  return executeQuery(async (connection) => {
    await connection.query('UPDATE users SET role = ?, is_approved = ? WHERE id = ?', [role, isApproved, userId]);
  });
}

async function verifyUser(userId) {
  return executeQuery(async (connection) => {
    await connection.query('UPDATE users SET is_verified = 1 WHERE id = ?', [userId]);
  });
}

// Fungsi untuk comments
async function addComment(postId, userId, content) {
  return executeQuery(async (connection) => {
    const [result] = await connection.query(
      'INSERT INTO comments (id, post_id, user_id, content) VALUES (UUID(), ?, ?, ?)',
      [postId, userId, content]
    );
    return result.insertId;
  });
}

// Fungsi untuk likes
async function addLike(postId, userId) {
  return executeQuery(async (connection) => {
    await connection.query(
      'INSERT INTO likes (id, post_id, user_id) VALUES (UUID(), ?, ?)',
      [postId, userId]
    );
  });
}

// Fungsi untuk post versions
async function savePostVersion(postId, content) {
  return executeQuery(async (connection) => {
    await connection.query(
      'INSERT INTO post_versions (id, post_id, content) VALUES (UUID(), ?, ?)',
      [postId, content]
    );
  });
}

// Fungsi untuk user tokens
async function saveUserToken(userId, token, type, expiresAt) {
  return executeQuery(async (connection) => {
    await connection.query(
      'INSERT INTO user_tokens (id, user_id, token, type, expires_at) VALUES (UUID(), ?, ?, ?, ?)',
      [userId, token, type, expiresAt]
    );
  });
}

async function getUserToken(userId, type) {
  return executeQuery(async (connection) => {
    const [rows] = await connection.query(
      'SELECT * FROM user_tokens WHERE user_id = ? AND type = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [userId, type]
    );
    return rows[0];
  });
}

async function deleteUserToken(userId, type) {
  return executeQuery(async (connection) => {
    await connection.query('DELETE FROM user_tokens WHERE user_id = ? AND type = ?', [userId, type]);
  });
}

async function verifyUserToken(userId, token, type = 'refresh') {
  return executeQuery(async (connection) => {
    const [rows] = await connection.query(
      'SELECT * FROM user_tokens WHERE user_id = ? AND token = ? AND type = ? AND expires_at > NOW()',
      [userId, token, type]
    );
    return rows[0];
  });
}

async function setCache(key, data, expires = 300) {
  try {
    if (redis) {
      await redis.setex(key, expires, JSON.stringify(data));
      logger.info(`Cache set for key: ${key}`);
    }
  } catch (error) {
    logger.error('Error setting cache:', error);
  }
}

async function getCache(key) {
  try {
    if (redis) {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    }
    return null;
  } catch (error) {
    logger.error('Error getting cache:', error);
    return null;
  }
}

async function deleteCache(key) {
  try {
    if (redis) {
      await redis.del(key);
      logger.info(`Cache deleted for key: ${key}`);
    }
  } catch (error) {
    logger.error('Error deleting cache:', error);
  }
}

async function clearCachePattern(pattern) {
  try {
    if (redis && typeof redis.keys === 'function') {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(keys);
        logger.info(`Cache cleared for pattern: ${pattern}`);
      }
    }
  } catch (error) {
    logger.error('Error clearing cache pattern:', error);
  }
}

module.exports = {
  pool,
  redis,
  getConnection,
  executeQuery,
  getAllPosts,
  getPostWithLabels,
  getSpotlightPosts,
  addNewPost,
  addLabelToPost,
  removeLabelFromPost,
  getAllLabels,
  getFeaturedPosts,
  createUser,
  addComment,
  addLike,
  savePostVersion,
  saveUserToken,
  updatePost,
  getUserByEmail,
  updateUserRole,
  verifyUser,
  getUserToken,
  deleteUserToken,
  verifyUserToken,
  cacheKeys,
  setCache,
  getCache,
  deleteCache,
  clearCachePattern
};
