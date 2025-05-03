// backend/config/databaseConfig.js
const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// Deteksi Railway environment
const isRailway = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_SERVICE_ID;

// Fungsi untuk membuat konfigurasi database
function createDbConfig(host, port, user, password, database, ssl) {
  return {
    host: host,
    port: port || 3306,
    user: user,
    password: password,
    database: database,
    waitForConnections: true, // Tunggu koneksi jika tidak tersedia
    connectionLimit: isRailway ? 5 : 2, // Tingkatkan batas koneksi untuk Railway
    idleTimeout: 60000, // 60 detik timeout untuk koneksi idle
    queueLimit: 0, // Tidak ada batas antrian
    enableKeepAlive: true, // Aktifkan keepalive
    keepAliveInitialDelay: 10000, // 10 detik delay awal untuk keepalive
    multipleStatements: false, // Nonaktifkan multiple statements untuk keamanan
    connectTimeout: 60000, // 60 detik timeout koneksi
    acquireTimeout: 60000, // 60 detik timeout untuk mendapatkan koneksi dari pool
    timeout: 60000, // 60 detik timeout untuk query
    decimalNumbers: true, // Konversi nilai desimal ke JavaScript number
    dateStrings: true, // Kembalikan tanggal sebagai string
    namedPlaceholders: true, // Gunakan placeholder bernama untuk query yang lebih jelas
    // Tambahkan dukungan untuk caching_sha2_password
    authPlugins: {
      mysql_native_password: () => () => Buffer.from([0]),
      caching_sha2_password: () => () => Buffer.from([0])
    },
    // Tambahkan SSL jika diperlukan
    ...(ssl === 'true' ? {
      ssl: {
        rejectUnauthorized: false
      }
    } : {})
  };
}

// Konfigurasi utama
const dbConfig = createDbConfig(
  process.env.DB_HOST,
  process.env.DB_PORT,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  process.env.DB_NAME,
  process.env.DB_SSL
);

// Konfigurasi fallback
const fallbackDbConfig = process.env.DB_FALLBACK_HOST ? createDbConfig(
  process.env.DB_FALLBACK_HOST,
  process.env.DB_FALLBACK_PORT,
  process.env.DB_FALLBACK_USER,
  process.env.DB_FALLBACK_PASSWORD,
  process.env.DB_FALLBACK_NAME,
  process.env.DB_FALLBACK_SSL
) : null;

// Log konfigurasi database
console.log('Primary database configuration:', {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER ? `${process.env.DB_USER.substring(0, 2)}...` : 'Not set',
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? 'enabled' : 'disabled',
  railway: isRailway ? 'true' : 'false'
});

if (fallbackDbConfig) {
  console.log('Fallback database configuration available:', {
    host: process.env.DB_FALLBACK_HOST,
    port: process.env.DB_FALLBACK_PORT,
    user: process.env.DB_FALLBACK_USER ? `${process.env.DB_FALLBACK_USER.substring(0, 2)}...` : 'Not set',
    database: process.env.DB_FALLBACK_NAME,
    ssl: process.env.DB_FALLBACK_SSL === 'true' ? 'enabled' : 'disabled'
  });
}

// Buat pool koneksi utama
let pool = mysql.createPool(dbConfig);
let fallbackPool = fallbackDbConfig ? mysql.createPool(fallbackDbConfig) : null;
let usingFallback = false;

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
let redis = null;
let inMemoryCache = {};

// Periksa apakah Redis diaktifkan dan apakah kita berada di Vercel
const isVercel = process.env.VERCEL === '1';
const redisEnabled = process.env.REDIS_ENABLED === 'true' && !isVercel; // Selalu nonaktifkan Redis di Vercel

// Selalu nonaktifkan Redis di Vercel, atau jika Redis tidak diaktifkan secara eksplisit
if (!redisEnabled) {
  logger.info('Redis disabled', {
    reason: isVercel ? 'Running on Vercel' : 'Not explicitly enabled',
    service: 'cache-service'
  });
} else {
  try {
    logger.info('Attempting to connect to Redis:', {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      service: 'cache-service'
    });

    // Buat instance Redis dengan timeout dan retry strategy yang lebih agresif
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      connectTimeout: 5000,
      maxRetriesPerRequest: 2,
      commandTimeout: 3000,
      retryStrategy(times) {
        // Hanya coba ulang 2 kali dengan delay 500ms
        if (times > 2) {
          logger.warn('Redis retry limit reached, giving up', { service: 'cache-service' });
          return null; // Berhenti mencoba
        }
        return 500;
      },
    });

    // Tangani error Redis
    redis.on('error', (err) => {
      logger.error('Redis Client Error', {
        error: err.message,
        code: err.code,
        service: 'cache-service'
      });

      // Jika terjadi error koneksi, set redis ke null
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        logger.warn('Redis connection failed, falling back to in-memory cache', { service: 'cache-service' });
        redis = null;
      }
    });

    redis.on('connect', () => {
      logger.info('Redis connected successfully', { service: 'cache-service' });
    });
  } catch (error) {
    logger.error('Failed to initialize Redis:', {
      error: error.message,
      stack: error.stack,
      service: 'cache-service'
    });
    // Fallback to in-memory cache if Redis initialization fails
    redis = null;
  }
}

// If Redis is disabled or failed to initialize, use in-memory cache
if (!redis) {
  logger.info('Redis disabled, using in-memory cache', { service: 'cache-service' });
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
  try {
    // Coba dapatkan koneksi dari pool utama
    return await pool.getConnection();
  } catch (error) {
    // Jika gagal dan fallbackPool tersedia, coba dapatkan koneksi dari fallbackPool
    if (fallbackPool && (
      error.message.includes('Access denied') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ECONNREFUSED')
    )) {
      logger.info('Switching to fallback database connection in getConnection', { service: 'database-service' });
      usingFallback = true;
      return await fallbackPool.getConnection();
    }
    throw error;
  }
}

const executeQuery = async (queryOrCallback, params = [], retryCount = 0) => {
  const MAX_RETRIES = 5;
  const BASE_RETRY_DELAY = 2000; // ms - Tingkatkan dari 1000 menjadi 2000 ms

  let connection = null;
  let connectionAcquired = false;
  let result = null;
  let currentPool = usingFallback && fallbackPool ? fallbackPool : pool;

  try {
    // Dapatkan koneksi dari pool
    try {
      connection = await currentPool.getConnection();
      connectionAcquired = true;

      // Log koneksi yang berhasil didapatkan
      logger.info(`Connection ${connection.threadId} acquired from ${usingFallback ? 'fallback' : 'primary'} pool`, {
        service: 'database-service',
        usingFallback
      });

      // Jika queryOrCallback adalah fungsi, jalankan dengan connection
      if (typeof queryOrCallback === 'function') {
        try {
          result = await queryOrCallback(connection);
        } catch (funcError) {
          logger.error('Error executing function with connection:', {
            error: funcError.message,
            stack: funcError.stack,
            service: 'database-service',
            usingFallback
          });
          throw funcError;
        }
      } else {
        // Jika queryOrCallback adalah string (query SQL)
        try {
          const [queryResult] = await connection.query(queryOrCallback, params);
          result = queryResult;
        } catch (queryError) {
          logger.error('Error executing query:', {
            error: queryError.message,
            query: typeof queryOrCallback === 'string' ? queryOrCallback.substring(0, 100) + '...' : 'Function',
            service: 'database-service',
            usingFallback
          });
          throw queryError;
        }
      }

      return result;
    } catch (connError) {
      // Tangani error koneksi
      logger.error('Connection error:', {
        error: connError.message,
        stack: connError.stack,
        retryCount,
        service: 'database-service',
        usingFallback
      });

      // Coba gunakan fallback pool jika tersedia dan belum digunakan
      if (!usingFallback && fallbackPool && (
        connError.message.includes('Access denied') ||
        connError.message.includes('ETIMEDOUT') ||
        connError.message.includes('ECONNREFUSED')
      )) {
        logger.info('Switching to fallback database connection', { service: 'database-service' });
        usingFallback = true;
        return executeQuery(queryOrCallback, params, 0); // Reset retry count
      }

      // Retry logic for connection errors
      if (retryCount < MAX_RETRIES &&
          (connError.message.includes('max_user_connections') ||
           connError.message.includes('Connection acquisition timeout') ||
           connError.message.includes('ETIMEDOUT') ||
           connError.message.includes('ECONNREFUSED') ||
           connError.message.includes('Queue limit reached'))) {
        logger.info(`Retrying database connection (${retryCount + 1}/${MAX_RETRIES})...`, {
          service: 'database-service',
          usingFallback
        });

        // Gunakan backoff eksponensial dengan jitter untuk mengurangi tekanan pada database
        const jitter = Math.random() * 1000; // Tambahkan jitter acak hingga 1 detik
        const delay = (BASE_RETRY_DELAY * Math.pow(2, retryCount)) + jitter;

        logger.info(`Waiting ${Math.round(delay / 1000)} seconds before retry...`, {
          service: 'database-service',
          usingFallback
        });
        await new Promise(resolve => setTimeout(resolve, delay));

        return executeQuery(queryOrCallback, params, retryCount + 1);
      }

      throw new Error(`Database connection error: ${connError.message}`);
    }
  } catch (error) {
    // Tangani error umum
    logger.error('Database query error:', {
      error: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      stack: error.stack,
      service: 'database-service',
      usingFallback
    });
    throw error;
  } finally {
    // Selalu lepaskan koneksi jika berhasil didapatkan
    if (connection && connectionAcquired) {
      try {
        // Periksa apakah koneksi masih valid dan belum dilepaskan
        if (connection.release && typeof connection.release === 'function') {
          connection.release();
          logger.info(`Connection ${connection.threadId} released from ${usingFallback ? 'fallback' : 'primary'} pool`, {
            service: 'database-service',
            usingFallback
          });
        }
      } catch (releaseError) {
        logger.warn('Error releasing connection:', {
          error: releaseError.message,
          service: 'database-service',
          usingFallback
        });
      }
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
    const getConnectionPromise = pool.getConnection();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Connection acquisition timeout')), 5000);
    });

    let connection;
    try {
      connection = await Promise.race([getConnectionPromise, timeoutPromise]);
      await connection.query('SELECT 1');
      logger.info('MySQL connection successful', { service: 'database-service' });
    } catch (dbError) {
      logger.error('MySQL connection test failed:', {
        error: dbError.message,
        code: dbError.code,
        errno: dbError.errno,
        sqlState: dbError.sqlState,
        sqlMessage: dbError.sqlMessage,
        service: 'database-service'
      });
      throw dbError;
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          logger.error('Error releasing test connection:', releaseError);
        }
      }
    }

    // Test Redis only if it's enabled
    if (redis) {
      try {
        await Promise.race([
          redis.ping(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 3000))
        ]);
        logger.info('Redis connection successful', { service: 'cache-service' });
      } catch (redisError) {
        logger.error('Redis connection test failed:', {
          error: redisError.message,
          code: redisError.code,
          service: 'cache-service'
        });
        // Don't throw here, just log the error and continue
        // We can operate without Redis
      }
    }
  } catch (error) {
    logger.error('Error testing connections:', {
      error: error.message,
      stack: error.stack,
      service: 'database-service'
    });
    throw error;
  }
}

// Fungsi untuk membersihkan koneksi yang tidak digunakan
async function cleanupIdleConnections() {
  try {
    // Dapatkan status pool
    const poolStatus = pool.pool ? {
      acquired: pool.pool._acquiringConnections.length,
      free: pool.pool._freeConnections.length,
      queue: pool.pool._connectionQueue.length,
      all: pool.pool._allConnections.length,
      total: pool.pool._allConnections.length + pool.pool._connectionQueue.length
    } : { acquired: 0, free: 0, queue: 0, all: 0, total: 0 };

    logger.info('Pool status before cleanup:', {
      ...poolStatus,
      service: 'database-service'
    });

    // Jika ada koneksi yang tidak digunakan, coba bersihkan
    if (poolStatus.free > 0) {
      // Dapatkan semua koneksi yang tidak digunakan
      const freeConnections = pool.pool._freeConnections;

      // Lepaskan koneksi yang tidak digunakan
      for (let i = freeConnections.length - 1; i >= 0; i--) {
        try {
          const conn = freeConnections[i];
          if (conn && typeof conn.release === 'function') {
            conn.release();
            logger.info(`Released idle connection ${conn.threadId} during cleanup`, { service: 'database-service' });
          }
        } catch (releaseError) {
          logger.warn('Error releasing idle connection during cleanup:', {
            error: releaseError.message,
            service: 'database-service'
          });
        }
      }
    }

    // Dapatkan status pool setelah pembersihan
    const newPoolStatus = pool.pool ? {
      acquired: pool.pool._acquiringConnections.length,
      free: pool.pool._freeConnections.length,
      queue: pool.pool._connectionQueue.length,
      all: pool.pool._allConnections.length,
      total: pool.pool._allConnections.length + pool.pool._connectionQueue.length
    } : { acquired: 0, free: 0, queue: 0, all: 0, total: 0 };

    logger.info('Pool status after cleanup:', {
      ...newPoolStatus,
      service: 'database-service'
    });

    return true;
  } catch (error) {
    logger.error('Error cleaning up idle connections:', {
      error: error.message,
      stack: error.stack,
      service: 'database-service'
    });
    return false;
  }
}

// Nonaktifkan pengujian koneksi otomatis untuk mengurangi koneksi saat startup
// testConnections();

// Hanya tambahkan event listener untuk error penting
pool.on('error', (err) => {
  logger.error('Unexpected error on idle MySQL client', {
    error: err.message,
    code: err.code,
    service: 'database-service'
  });
  // Jangan panggil testConnections() untuk menghindari loop error
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

async function clearAllCache() {
  try {
    if (redis && typeof redis.keys === 'function') {
      const keys = await redis.keys('*');
      if (keys.length > 0) {
        await redis.del(keys);
        logger.info(`All cache cleared (${keys.length} keys)`);
      }
    }
  } catch (error) {
    logger.error('Error clearing all cache:', error);
  }
}

// Fungsi untuk membersihkan koneksi yang tidak digunakan
async function cleanupIdleConnections() {
  try {
    // Coba dapatkan koneksi baru dan langsung lepaskan
    // Ini akan membantu memastikan pool dalam keadaan baik
    try {
      const testConnection = await pool.getConnection();
      if (testConnection) {
        testConnection.release();
        // Kurangi verbositas log
        if (process.env.DEBUG_DB === 'true') {
          logger.info('Test connection acquired and released successfully', { service: 'database-service' });
        }
      }
    } catch (connError) {
      logger.warn('Could not acquire test connection during cleanup', {
        error: connError.message,
        service: 'database-service'
      });
    }

    // Dapatkan status pool jika memungkinkan
    if (process.env.DEBUG_DB === 'true') {
      let poolStatus = { acquired: 0, free: 0, queue: 0, all: 0, total: 0 };

      try {
        if (pool && pool.pool) {
          // Periksa apakah properti internal tersedia
          const hasAcquiring = Array.isArray(pool.pool._acquiringConnections);
          const hasFree = Array.isArray(pool.pool._freeConnections);
          const hasQueue = Array.isArray(pool.pool._connectionQueue);
          const hasAll = Array.isArray(pool.pool._allConnections);

          poolStatus = {
            acquired: hasAcquiring ? pool.pool._acquiringConnections.length : 0,
            free: hasFree ? pool.pool._freeConnections.length : 0,
            queue: hasQueue ? pool.pool._connectionQueue.length : 0,
            all: hasAll ? pool.pool._allConnections.length : 0,
            total: (hasAll ? pool.pool._allConnections.length : 0) + (hasQueue ? pool.pool._connectionQueue.length : 0)
          };
        }

        logger.info('Pool status:', {
          ...poolStatus,
          service: 'database-service'
        });
      } catch (statusError) {
        logger.warn('Could not get pool status', {
          error: statusError.message,
          service: 'database-service'
        });
      }
    }

    return true;
  } catch (error) {
    logger.error('Error cleaning up idle connections:', {
      error: error.message,
      stack: error.stack,
      service: 'database-service'
    });
    return false;
  }
}

// Jalankan pembersihan koneksi setiap 5 menit (300000 ms) untuk mengurangi log yang berlebihan
const cleanupInterval = setInterval(cleanupIdleConnections, 300000);

// Pastikan interval dibersihkan saat aplikasi berhenti
process.on('SIGINT', () => {
  clearInterval(cleanupInterval);
  logger.info('Cleanup interval cleared', { service: 'database-service' });
});

// Fungsi untuk menangani koneksi yang hilang
async function handleLostConnection() {
  try {
    logger.warn('Handling lost connection...', { service: 'database-service' });

    // Coba bersihkan semua koneksi yang ada
    await cleanupIdleConnections();

    // Coba buat koneksi baru untuk memverifikasi bahwa database masih dapat diakses
    try {
      const testConnection = await pool.getConnection();
      testConnection.release();

      logger.info('Database connection restored', { service: 'database-service' });
      return true;
    } catch (testError) {
      logger.error('Failed to acquire test connection:', {
        error: testError.message,
        service: 'database-service'
      });
      throw testError; // Re-throw untuk masuk ke blok catch berikutnya
    }
  } catch (error) {
    logger.error('Failed to restore database connection:', {
      error: error.message,
      stack: error.stack,
      service: 'database-service'
    });

    // Jika gagal, coba buat pool baru
    try {
      logger.warn('Recreating connection pool...', { service: 'database-service' });

      // Tutup pool yang ada jika memungkinkan
      try {
        if (pool && typeof pool.end === 'function') {
          await pool.end();
          logger.info('Existing pool closed successfully', { service: 'database-service' });
        }
      } catch (endError) {
        logger.warn('Error closing existing pool:', {
          error: endError.message,
          service: 'database-service'
        });
        // Lanjutkan meskipun gagal menutup pool yang ada
      }

      // Buat pool baru
      pool = mysql.createPool(dbConfig);

      // Tambahkan event listener
      pool.on('acquire', function (connection) {
        logger.info(`Connection ${connection.threadId} acquired`);
      });

      pool.on('release', function (connection) {
        logger.info(`Connection ${connection.threadId} released`);
      });

      pool.on('enqueue', function () {
        logger.warn('Waiting for available connection slot');
      });

      // Verifikasi koneksi baru
      try {
        const newConnection = await pool.getConnection();
        newConnection.release();

        logger.info('Connection pool recreated successfully', { service: 'database-service' });
        return true;
      } catch (verifyError) {
        logger.error('Failed to verify new connection pool:', {
          error: verifyError.message,
          service: 'database-service'
        });
        throw verifyError; // Re-throw untuk masuk ke blok catch berikutnya
      }
    } catch (recreateError) {
      logger.error('Failed to recreate connection pool:', {
        error: recreateError.message,
        stack: recreateError.stack,
        service: 'database-service'
      });
      return false;
    }
  }
}

// Jalankan penanganan koneksi yang hilang setiap 10 menit untuk mengurangi beban
const connectionCheckInterval = setInterval(async () => {
  try {
    // Cek apakah pool sudah ditutup
    if (pool.pool && pool.pool._closed) {
      logger.warn('Pool is closed, attempting to recreate...', { service: 'database-service' });
      await handleLostConnection();
      return;
    }

    // Bersihkan koneksi idle setiap kali interval berjalan
    await cleanupIdleConnections();

    // Coba buat koneksi untuk memverifikasi bahwa database masih dapat diakses
    const testConnection = await pool.getConnection();
    testConnection.release();

    // Log hanya jika debug diaktifkan
    if (process.env.DEBUG_DB === 'true') {
      logger.info('Connection check successful', { service: 'database-service' });
    }
  } catch (error) {
    logger.error('Connection check failed:', {
      error: error.message,
      service: 'database-service'
    });

    // Jika gagal, coba tangani koneksi yang hilang
    await handleLostConnection();
  }
}, 600000); // 10 menit

// Jalankan pembersihan koneksi idle lebih sering (setiap 2 menit)
const idleConnectionCleanupInterval = setInterval(async () => {
  try {
    await cleanupIdleConnections();
  } catch (error) {
    logger.error('Error in idle connection cleanup interval:', {
      error: error.message,
      service: 'database-service'
    });
  }
}, 120000); // 2 menit

// Pastikan interval dibersihkan saat aplikasi berhenti
process.on('SIGINT', () => {
  clearInterval(connectionCheckInterval);
  clearInterval(idleConnectionCleanupInterval);
  clearInterval(connectionCheckInterval);
  logger.info('All intervals cleared', { service: 'database-service' });
  process.exit(0);
});

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
  clearCachePattern,
  clearAllCache,
  cleanupIdleConnections,
  handleLostConnection,
  testConnections
};
