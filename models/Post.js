const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const { executeQuery } = require('../config/databaseConfig');
const moment = require('moment');
const UniqueLabel = require('./UniqueLabel');
const PostLabel = require('./PostLabel');
const crypto = require('crypto');
const db = require('../config/databaseConfig');

const formatImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  return `${process.env.BASE_URL}/uploads/${imagePath.split('/').pop()}`;
};

class Post {
  constructor(data) {
    this.id = data.id;
    this.title = data.title;
    this.content = data.content;
    this.status = data.status;
    this.publish_date = data.publish_date;
    this.is_featured = data.is_featured;
    this.is_spotlight = data.is_spotlight;
    this.image = data.image;
    this.excerpt = data.excerpt;
    this.slug = data.slug;
    this.version = data.version;
    this.user_id = data.user_id;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
    this.deleted_at = data.deleted_at;
  }

  static async getAllPosts(page = 1, limit = 10, search = '', category = '', label = '') {
    const offset = (page - 1) * limit;

    return executeQuery(async (connection) => {
      let query = `
        SELECT DISTINCT
          p.*,
          GROUP_CONCAT(ul.id, ':', ul.label) AS labels
        FROM posts p
        LEFT JOIN post_labels pl ON p.id = pl.post_id
        LEFT JOIN unique_labels ul ON pl.label_id = ul.id
      `;

      let countQuery = 'SELECT COUNT(DISTINCT p.id) as total FROM posts p';
      let params = [];
      let whereClause = [];

      if (search) {
        whereClause.push('(p.title LIKE ? OR p.content LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }

      if (category) {
        whereClause.push('p.category = ?');
        params.push(category);
      }

      if (label) {
        whereClause.push('ul.label = ?');
        params.push(label);
      }

      if (whereClause.length > 0) {
        const whereString = whereClause.join(' AND ');
        query += ` WHERE ${whereString}`;
        countQuery += ` WHERE ${whereString}`;
      }

      query += ' GROUP BY p.id ORDER BY p.publish_date DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), offset);

      console.log('Query:', query);
      console.log('Params:', [...params, limit, offset]);

      const [posts] = await connection.query(query, [...params, parseInt(limit), offset]);
      const [countResult] = await connection.query(countQuery, params);

      const totalPosts = countResult[0].total;
      const totalPages = Math.ceil(totalPosts / limit);

      console.log('Pagination info:', {
        totalPosts,
        totalPages,
        currentPage: page,
        limit,
        offset
      });

      return {
        posts: posts.map(post => ({
          ...post,
          labels: post.labels ? post.labels.split(',').map(label => {
            const [id, name] = label.split(':');
            return { id, name };
          }) : []
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: totalPosts,
          limit: parseInt(limit)
        }
      };
    });
  }

  static async findAll(isFeatured = false, page = 1, limit = 20) {
    return executeQuery(async (connection) => {
      const offset = (page - 1) * limit;

      let query = 'SELECT p.* FROM posts p';
      const params = [];

      if (isFeatured) {
        query += ' WHERE p.is_featured = ?';
        params.push(1);
      }

      // Add count query
      const countQuery = `SELECT COUNT(*) as total FROM posts p${isFeatured ? ' WHERE p.is_featured = ?' : ''}`;

      query += ' ORDER BY p.publish_date DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), offset);

      const [rows] = await connection.query(query, params);
      const [countResult] = await connection.query(countQuery, isFeatured ? [1] : []);

      const posts = [];
      for (const row of rows) {
        const labels = await PostLabel.getLabelsForPost(row.id);
        posts.push(this.mapRowToPost(row, labels));
      }

      return {
        posts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(countResult[0].total / limit),
          totalItems: countResult[0].total,
          itemsPerPage: parseInt(limit)
        }
      };
    });
  }

  static async saveVersion(postId, oldData) {
    return executeQuery(async (connection) => {
      // Hanya simpan content ke tabel post_versions
      const insertQuery = `
        INSERT INTO post_versions (
          id,
          post_id,
          content,
          created_at
        ) VALUES (UUID(), ?, ?, CURRENT_TIMESTAMP)
      `;

      const values = [
        postId,
        oldData.content
      ];

      await connection.query(insertQuery, values);
    });
  }

  static async update(id, updateData) {
    return executeQuery(async (connection) => {
      try {
        // Start transaction
        await connection.query('START TRANSACTION');

        // Update post data
        const [result] = await connection.query(
          `UPDATE posts SET
            title = ?,
            content = ?,
            status = ?,
            publish_date = ?,
            is_featured = ?,
            is_spotlight = ?,
            image = ?,
            excerpt = ?,
            slug = ?,
            version = ?,
            updated_at = NOW()
           WHERE id = ? AND deleted_at IS NULL`,
          [
            updateData.title,
            updateData.content,
            updateData.status,
            updateData.publish_date,
            updateData.is_featured ? 1 : 0,
            updateData.is_spotlight ? 1 : 0,
            updateData.image,
            updateData.excerpt,
            updateData.slug,
            updateData.version,
            id
          ]
        );

        if (result.affectedRows === 0) {
          throw new Error('Post tidak ditemukan atau sudah dihapus');
        }

        // Handle labels jika ada
        if (updateData.labels) {
          await PostLabel.updateLabelsForPost(id, updateData.labels);
        }

        // Simpan versi baru jika content berubah
        if (updateData.content !== updateData.previous_content) {
          await connection.query(
            `INSERT INTO post_versions (id, post_id, content, created_at)
             VALUES (?, ?, ?, NOW())`,
            [uuidv4(), id, updateData.content]
          );
        }

        // Commit transaction
        await connection.query('COMMIT');

        // Get updated post with labels
        const updatedPost = await this.findById(id);
        logger.info(`Post updated successfully: ${id}`);

        return updatedPost;

      } catch (error) {
        await connection.query('ROLLBACK');
        logger.error('Error updating post:', error);
        throw error;
      }
    });
  }

  static async delete(id) {
    return executeQuery(async (connection) => {
      await PostLabel.deleteAllForPost(id);
      const query = 'DELETE FROM posts WHERE id = ?';
      const [result] = await connection.query(query, [id]);
      return result.affectedRows > 0;
    });
  }

  static async toggleFeatured(id, isFeatured) {
    return executeQuery(async (connection) => {
      logger.info('=== Toggling Featured Status in Database ===', {
        postId: id,
        newStatus: isFeatured
      });

      // Cek post terlebih dahulu
      const [existingPost] = await connection.query(
        'SELECT id, title, is_featured, status, deleted_at FROM posts WHERE id = ?',
        [id]
      );

      logger.info('Existing post data:', {
        found: existingPost.length > 0,
        postId: existingPost[0]?.id,
        title: existingPost[0]?.title,
        currentFeatured: existingPost[0]?.is_featured,
        status: existingPost[0]?.status,
        deleted_at: existingPost[0]?.deleted_at
      });

      if (!existingPost.length) {
        throw new Error('Post tidak ditemukan');
      }

      // Jika akan set featured, reset dulu semua
      if (isFeatured) {
        logger.info('Resetting all featured posts before setting new one');
        await connection.query(`
          UPDATE posts
          SET is_featured = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE is_featured = 1
          AND deleted_at IS NULL
        `);
      }

      // Update post yang dipilih
      const query = `
        UPDATE posts
        SET is_featured = ?,
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      const [result] = await connection.query(query, [isFeatured ? 1 : 0, id]);

      logger.info('Update result:', {
        affectedRows: result.affectedRows,
        postId: id,
        newFeaturedStatus: isFeatured ? 1 : 0
      });

      if (result.affectedRows === 0) {
        throw new Error('Gagal mengupdate status featured');
      }

      // Verifikasi update
      const [verifyPost] = await connection.query(
        'SELECT id, title, is_featured, status, deleted_at FROM posts WHERE id = ?',
        [id]
      );

      logger.info('Post after update:', {
        postId: verifyPost[0]?.id,
        title: verifyPost[0]?.title,
        is_featured: verifyPost[0]?.is_featured,
        status: verifyPost[0]?.status,
        deleted_at: verifyPost[0]?.deleted_at
      });

      return await this.findById(id);
    });
  }

  static async getFeaturedPost(limit = 1) {
    return executeQuery(async (connection) => {
      logger.info('=== Getting Featured Post from Database ===');

      // Cek jumlah post yang featured
      const [countResult] = await connection.query(`
        SELECT COUNT(*) as count
        FROM posts
        WHERE is_featured = 1
        AND deleted_at IS NULL
        AND status = 'published'
      `);

      logger.info('Featured posts count:', {
        count: countResult[0].count
      });

      const query = `
        SELECT p.*, u.name as author_name
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.is_featured = 1
        AND p.deleted_at IS NULL
        AND p.status = 'published'
        ORDER BY p.created_at DESC
        LIMIT ?
      `;

      logger.info('Executing featured post query:', {
        query,
        limit
      });

      const [rows] = await connection.query(query, [limit]);

      logger.info('Featured post query result:', {
        found: rows.length > 0,
        postId: rows[0]?.id,
        title: rows[0]?.title,
        is_featured: rows[0]?.is_featured,
        status: rows[0]?.status,
        deleted_at: rows[0]?.deleted_at
      });

      if (!rows.length) {
        logger.warn('No featured posts found');
        return {
          data: [],
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalItems: 0,
            limit
          }
        };
      }

      return {
        data: rows.map(row => Post.mapRowToPost(row)),
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalItems: rows.length,
          limit
        }
      };
    });
  }

  static async unfeatureAll(excludeId = null) {
    return executeQuery(async (connection) => {
      let query = 'UPDATE posts SET is_featured = 0, version = version + 1, updated_at = CURRENT_TIMESTAMP';
      const params = [];
      if (excludeId) {
        query += ' WHERE id != ?';
        params.push(excludeId);
      }
      await connection.query(query, params);
    });
  }

  static async getTotalCount() {
    return executeQuery(async (connection) => {
      const query = 'SELECT COUNT(*) as count FROM posts';
      const [result] = await connection.query(query);
      return result[0].count;
    });
  }

  static async getPaginatedPosts(page, limit) {
    return executeQuery(async (connection) => {
      const offset = (page - 1) * limit;
      const countQuery = 'SELECT COUNT(*) as total FROM posts WHERE is_featured = 0';
      const [countResult] = await connection.query(countQuery);
      const totalCount = countResult[0].total;

      const query = `
        SELECT * FROM posts
        WHERE is_featured = 0
        ORDER BY publish_date DESC
        LIMIT ? OFFSET ?
      `;
      const [posts] = await connection.query(query, [limit, offset]);

      return {
        posts,
        totalPages: Math.ceil(totalCount / limit),
        totalCount
      };
    });
  }

  static async getPostsByAuthor(authorId, options = {}) {
    return executeQuery(async (connection) => {
      try {
        // Ekstrak options atau gunakan nilai default
        const {
          page = 1,
          limit = 10,
          includeLabels = true,
          search = '',
          dateFrom = '',
          dateTo = '',
          labelId = ''
        } = options;

        const offset = (page - 1) * limit;

        // Buat array untuk parameter WHERE
        const whereConditions = ['p.author_id = ? AND p.deleted_at IS NULL'];
        const queryParams = [authorId];

        // Tambahkan kondisi pencarian jika ada
        if (search) {
          whereConditions.push('(p.title LIKE ? OR p.content LIKE ?)');
          queryParams.push(`%${search}%`, `%${search}%`);
        }

        // Tambahkan filter tanggal jika ada
        if (dateFrom) {
          whereConditions.push('DATE(p.created_at) >= DATE(?)');
          queryParams.push(dateFrom);
        }

        if (dateTo) {
          whereConditions.push('DATE(p.created_at) <= DATE(?)');
          queryParams.push(dateTo);
        }

        // Tambahkan filter label jika ada
        let joinLabel = '';
        if (labelId) {
          joinLabel = 'LEFT JOIN post_labels pl ON p.id = pl.post_id';
          whereConditions.push('pl.label_id = ?');
          queryParams.push(labelId);
        }

        // Query dasar untuk mengambil post
        let query = `
          SELECT DISTINCT p.*, u.name as author_name
          FROM posts p
          ${joinLabel}
          LEFT JOIN users u ON p.author_id = u.id
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY p.created_at DESC
          LIMIT ? OFFSET ?
        `;

        // Tambahkan parameter untuk LIMIT dan OFFSET
        queryParams.push(limit, offset);

        // Eksekusi query untuk mendapatkan post
        const [posts] = await connection.query(query, queryParams);

        // Jika includeLabels=true, ambil label untuk setiap post
        if (includeLabels && posts.length > 0) {
          // Ambil semua ID post
          const postIds = posts.map(post => post.id);

          // Query untuk mengambil label untuk semua post sekaligus
          const labelsQuery = `
            SELECT pl.post_id, ul.id as label_id, ul.label
            FROM post_labels pl
            JOIN unique_labels ul ON pl.label_id = ul.id
            WHERE pl.post_id IN (?)
          `;

          const [labelsResults] = await connection.query(labelsQuery, [postIds]);

          // Kelompokkan label berdasarkan post_id
          const labelsMap = {};
          labelsResults.forEach(row => {
            if (!labelsMap[row.post_id]) {
              labelsMap[row.post_id] = [];
            }
            labelsMap[row.post_id].push({
              id: row.label_id,
              label: row.label
            });
          });

          // Tambahkan label ke setiap post
          posts.forEach(post => {
            post.labels = labelsMap[post.id] || [];
          });
        } else {
          // Jika tidak perlu label, tetap berikan array kosong
          posts.forEach(post => {
            post.labels = [];
          });
        }

        // Hitung total post untuk pagination dengan filter yang sama
        const countQuery = `
          SELECT COUNT(DISTINCT p.id) as total
          FROM posts p
          ${joinLabel}
          WHERE ${whereConditions.join(' AND ')}
        `;

        // Gunakan parameter yang sama kecuali limit dan offset
        const countParams = [...queryParams];
        countParams.pop(); // Hapus offset
        countParams.pop(); // Hapus limit

        const [countResult] = await connection.query(countQuery, countParams);
        const total = countResult[0].total;

        return {
          posts,
          totalPages: Math.ceil(total / limit),
          totalCount: total
        };
      } catch (error) {
        logger.error('Error in getPostsByAuthor:', error);
        throw error;
      }
    });
  }

  static async incrementViews(postId) {
    return executeQuery(async (connection) => {
      const query = 'UPDATE posts SET views = views + 1 WHERE id = ?';
      await connection.query(query, [postId]);
    });
  }

  static async getPostsWithDetails(limit = 20, page = 1, includeLabels = true, sortBy = 'created_at', sortOrder = 'desc') {
    return executeQuery(async (connection) => {
      const offset = (page - 1) * limit;
      const query = `
        SELECT p.*, u.name as author_name,
               COUNT(DISTINCT l.id) as like_count,
               COUNT(DISTINCT c.id) as comment_count
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments c ON p.id = c.post_id
        GROUP BY p.id
        ORDER BY p.${sortBy} ${sortOrder}
        LIMIT ? OFFSET ?
      `;
      const [rows] = await connection.query(query, [limit, offset]);

      if (includeLabels) {
        for (const post of rows) {
          post.labels = await PostLabel.getLabelsForPost(post.id);
        }
      }

      return rows;
    });
  }

  static async getVersions(postId) {
    return executeQuery(async (connection) => {
      const query = `
        SELECT
          pv.id,
          pv.content,
          pv.created_at
        FROM post_versions pv
        WHERE pv.post_id = ?
        ORDER BY pv.created_at DESC
      `;

      const [versions] = await connection.query(query, [postId]);
      return versions;
    });
  }

  static async getPostsWithDetails({ limit = 20, page = 1, includeLabels = true, sortBy = 'created_at', sortOrder = 'desc' }) {
    return executeQuery(async (connection) => {
      const offset = (page - 1) * limit;
      const query = `
        SELECT p.*, u.name as author_name,
               COUNT(DISTINCT l.id) as like_count,
               COUNT(DISTINCT c.id) as comment_count
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments c ON p.id = c.post_id
        GROUP BY p.id
        ORDER BY p.${sortBy} ${sortOrder}
        LIMIT ? OFFSET ?
      `;
      const [rows] = await connection.query(query, [limit, offset]);

      if (includeLabels) {
        for (const post of rows) {
          post.labels = await PostLabel.getLabelsForPost(post.id);
        }
      }

      return { posts: rows };
    });
  }

  static async getPostVersions(id) {
    return executeQuery(async (connection) => {
      const query = 'SELECT * FROM post_versions WHERE post_id = ? ORDER BY created_at DESC';
      const [rows] = await connection.query(query, [id]);
      return rows;
    });
  }

  static async getAnalytics(postId) {
    return executeQuery(async (connection) => {
      const query = `
        SELECT
          p.id, p.title, p.views,
          COUNT(DISTINCT l.id) as like_count,
          COUNT(DISTINCT c.id) as comment_count
        FROM posts p
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments c ON p.id = c.post_id
        WHERE p.id = ?
        GROUP BY p.id
      `;
      const [rows] = await connection.query(query, [postId]);
      return rows[0];
    });
  }

  static async getSpotlightPosts() {
    return executeQuery(async (connection) => {
      const query = `
        SELECT p.*, u.name as author_name
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.is_spotlight = 1
        ORDER BY p.publish_date DESC
      `;
      const [rows] = await connection.query(query);
      return rows;
    });
  }

  static async toggleSpotlight(id, isSpotlight) {
    return executeQuery(async (connection) => {
      const query = 'UPDATE posts SET is_spotlight = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      const [result] = await connection.query(query, [isSpotlight ? 1 : 0, id]);

      if (result.affectedRows === 0) {
        throw new Error('Post tidak ditemukan');
      }

      return await this.findById(id);
    });
  }

  static async getAllSpotlightPosts() {
    return executeQuery(async (connection) => {
      logger.info('Fetching all spotlight posts');
      const query = 'SELECT * FROM posts WHERE is_spotlight = 1 ORDER BY publish_date DESC';
      const [rows] = await connection.query(query);
      const postsWithLabels = await Promise.all(rows.map(async (row) => {
        const labels = await PostLabel.getLabelsForPost(row.id);
        return this.mapRowToPost(row, labels);
      }));
      logger.info(`Found ${postsWithLabels.length} spotlight posts`);
      return postsWithLabels;
    });
  }

  static async getFeaturedPosts(limit = 1) {
    return executeQuery(async (connection) => {
      const query = `
        SELECT p.*, u.name as author_name,
               COUNT(DISTINCT l.id) as like_count,
               COUNT(DISTINCT c.id) as comment_count
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments c ON p.id = c.post_id
        WHERE p.is_featured = 1
        GROUP BY p.id
        ORDER BY p.publish_date DESC
        LIMIT ?
      `;
      const [rows] = await connection.query(query, [limit]);

      for (const post of rows) {
        post.labels = await PostLabel.getLabelsForPost(post.id);
      }

      return rows;
    });
  }

  static async create(post) {
    return executeQuery(async (connection) => {
      const query = `INSERT INTO posts (id, title, content, image, publish_date, is_featured, is_spotlight, author_id, excerpt, slug, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const values = [
        post.id,
        post.title,
        post.content,
        post.image,
        post.publish_date,
        post.is_featured,
        post.is_spotlight,
        post.author_id,
        post.excerpt,
        post.slug,
        post.status
      ];

      await connection.query(query, values);
      return post;
    });
  }

  static async updateLabelsForPost(postId, newLabelIds) {
    return executeQuery(async (connection) => {
      await PostLabel.deleteAllForPost(postId);
      if (newLabelIds && newLabelIds.length > 0) {
        await PostLabel.addLabelsToPost(postId, newLabelIds);
      }
    });
  }

  static async findBySlug(slug) {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM posts WHERE slug = ?', [slug]);
      return rows[0];
    });
  }

  static async findBySlugOrId(slugOrId) {
    return executeQuery(async (connection) => {
      const query = `
        SELECT p.*, u.name as author_name, GROUP_CONCAT(ul.id) as label_ids, GROUP_CONCAT(ul.label) as label_names
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN post_labels pl ON p.id = pl.post_id
        LEFT JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE p.slug = ? OR p.id = ?
        GROUP BY p.id
      `;
      const [rows] = await connection.query(query, [slugOrId, slugOrId]);
      if (rows.length === 0) return null;

      const post = this.mapRowToPost(rows[0]);
      post.author_name = rows[0].author_name;
      post.labels = rows[0].label_ids ? rows[0].label_ids.split(',').map((id, index) => ({
        id,
        name: rows[0].label_names.split(',')[index]
      })) : [];

      return post;
    });
  }

  static mapRowToPost(row, labels) {
    return new Post({
      id: row.id,
      title: row.title,
      content: row.content,
      image: row.image,
      created_at: row.created_at,
      updated_at: row.updated_at,
      publish_date: row.publish_date,
      is_featured: row.is_featured,
      is_spotlight: row.is_spotlight,
      author_id: row.author_id,
      excerpt: row.excerpt,
      slug: row.slug,
      status: row.status,
      views: row.views,
      version: row.version,
      labels: labels || row.labels
    });
  }

  // Tambahkan metode findOne sebagai metode statis
  static async findOne(condition) {
    return executeQuery(async (connection) => {
      const whereClause = Object.entries(condition)
        .map(([key, value]) => `${key} = ?`)
        .join(' AND ');
      const query = `SELECT * FROM posts WHERE ${whereClause} LIMIT 1`;
      const [rows] = await connection.query(query, Object.values(condition));
      return rows[0] || null;
    });
  }

  static async delete(id) {
    return executeQuery(async (connection) => {
      await PostLabel.deleteAllForPost(id);
      const query = 'DELETE FROM posts WHERE id = ?';
      const [result] = await connection.query(query, [id]);
      return result.affectedRows > 0;
    });
  }

  static async findRelated(postId) {
    return executeQuery(async (connection) => {
      const post = await Post.findOne({ id: postId });
      if (!post) return [];

      const labelIds = post.labels && post.labels.length > 0 ? post.labels.map(label => label.id) : [];
      const titleWords = post.title ? post.title.split(' ').map(word => word.replace(/[^\w\s]/gi, '')) : [];

      // Jika tidak ada label atau kata-kata judul, kembalikan array kosong
      if (labelIds.length === 0 && titleWords.length === 0) {
        return [];
      }

      let query = `
        SELECT p.*
        FROM posts p
        LEFT JOIN post_labels pl ON p.id = pl.post_id
        WHERE p.id != ? AND (
          ${labelIds.length > 0 ? 'pl.label_id IN (?)' : '1=0'}
          ${titleWords.length > 0 ? 'OR ' + titleWords.map(() => 'p.title LIKE ?').join(' OR ') : ''}
        )
        GROUP BY p.id
      `;

      if (labelIds.length > 0) {
        query += ` ORDER BY (
          CASE WHEN pl.label_id IN (?) THEN 1 ELSE 0 END
        ) DESC`;
      }

      if (titleWords.length > 0) {
        query += `${labelIds.length > 0 ? ',' : ' ORDER BY'} (
          ${titleWords.map(() => 'CASE WHEN p.title LIKE ? THEN 1 ELSE 0 END').join(' + ')}
        ) DESC`;
      }

      query += ' LIMIT 5';

      const params = [
        postId,
        ...(labelIds.length > 0 ? [labelIds] : []),
        ...titleWords.map(word => `%${word}%`),
        ...(labelIds.length > 0 ? [labelIds] : []),
        ...titleWords.map(word => `%${word}%`)
      ];

      const [rows] = await connection.query(query, params);
      const relatedPosts = [];

      for (const row of rows) {
        const labels = await UniqueLabel.getLabelsForPost(row.id);
        relatedPosts.push(this.mapRowToPost(row, labels));
      }
      return relatedPosts;
    });
  }

  static async toggleFeatured(id, isFeatured) {
    return executeQuery(async (connection) => {
      const query = 'UPDATE posts SET is_featured = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      const [result] = await connection.query(query, [isFeatured ? 1 : 0, id]);

      if (result.affectedRows === 0) {
        throw new Error('Post tidak ditemukan');
      }

      return await this.findById(id);
    });
  }

  static async getAllPublishedPosts(page = 1, limit = 20, sort = 'publish_date:desc') {
    const [sortField, sortOrder] = sort.split(':');
    return executeQuery(async (connection) => {
      const offset = (page - 1) * limit;

      // Query untuk mengambil semua post yang dipublish
      const query = `
        SELECT
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
        WHERE p.status = 'published'
        AND p.deleted_at IS NULL
        GROUP BY p.id, u.name
        ORDER BY p.${sortField} ${sortOrder}
        LIMIT ? OFFSET ?
      `;

      // Query untuk menghitung total post
      const countQuery = `
        SELECT COUNT(DISTINCT p.id) as total
        FROM posts p
        WHERE p.status = 'published'
        AND p.deleted_at IS NULL
      `;

      // Eksekusi query
      const [posts] = await connection.query(query, [limit, offset]);
      const [countResult] = await connection.query(countQuery);

      // Format hasil
      const formattedPosts = posts.map(post => ({
        ...post,
        labels: post.labels ? JSON.parse(`[${post.labels}]`).filter(label => label !== null) : []
      }));

      return {
        posts: formattedPosts,
        totalCount: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      };
    });
  }

  static async getPostsByLabel(labelId, page = 1, limit = 20, sort = 'created_at:desc', status = null) {
    const [sortField, sortOrder] = sort.split(':');
    return executeQuery(async (connection) => {
      const offset = (page - 1) * limit;

      // Perbaiki query utama
      const query = `
        SELECT DISTINCT
          p.*,
          u.name as author_name,
          COUNT(DISTINCT l.id) as like_count,
          COUNT(DISTINCT c.id) as comment_count,
          GROUP_CONCAT(
            DISTINCT JSON_OBJECT(
              'id', ul.id,
              'label', ul.label
            )
          ) as labels
        FROM posts p
        INNER JOIN post_labels pl ON p.id = pl.post_id  /* Ganti LEFT JOIN jadi INNER JOIN */
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments c ON p.id = c.post_id
        LEFT JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE pl.label_id = ?
        ${status ? 'AND p.status = ?' : ''}
        GROUP BY p.id, u.name  /* Tambahkan kolom yang di-select tapi tidak di-aggregate */
        ORDER BY p.${sortField} ${sortOrder.toUpperCase()}
        LIMIT ? OFFSET ?
      `;

      // Perbaiki query hitung total
      const countQuery = `
        SELECT COUNT(DISTINCT p.id) as total
        FROM posts p
        INNER JOIN post_labels pl ON p.id = pl.post_id
        WHERE pl.label_id = ?
        ${status ? 'AND p.status = ?' : ''}
      `;

      // Eksekusi query dengan parameter yang benar
      const queryParams = status ? [labelId, status, limit, offset] : [labelId, limit, offset];
      const [posts] = await connection.query(query, queryParams);
      const countQueryParams = status ? [labelId, status] : [labelId];
      const [countResult] = await connection.query(countQuery, countQueryParams);

      // Pastikan format data konsisten
      const formattedPosts = posts.map(post => ({
        ...post,
        labels: post.labels ?
          JSON.parse(`[${post.labels}]`).filter(label => label !== null) : []
      }));

      // Return dengan format yang konsisten
      return {
        posts: formattedPosts,
        totalCount: parseInt(countResult[0].total),
        totalPages: Math.ceil(parseInt(countResult[0].total) / limit),
        currentPage: parseInt(page),
        limit: parseInt(limit)
      };
    });
  }

  // Tambahkan fungsi generateUniqueSlug yang benar
  static async generateUniqueSlug(title, existingId = null) {
    return executeQuery(async (connection) => {
      // Buat base slug dari title
      let baseSlug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') // Ganti karakter non-alphanumeric dengan dash
        .replace(/^-+|-+$/g, '') // Hapus dash di awal dan akhir
        .replace(/[àáâãäå]/g, 'a')
        .replace(/[èéêë]/g, 'e')
        .replace(/[ìíîï]/g, 'i')
        .replace(/[òóôõö]/g, 'o')
        .replace(/[ùúûü]/g, 'u')
        .replace(/[ýÿ]/g, 'y')
        .replace(/[ñ]/g, 'n')
        .replace(/[ç]/g, 'c');

      let finalSlug = baseSlug;
      let counter = 1;
      let slugExists = true;

      while (slugExists) {
        const query = existingId
          ? 'SELECT COUNT(*) as count FROM posts WHERE slug = ? AND id != ?'
          : 'SELECT COUNT(*) as count FROM posts WHERE slug = ?';

        const params = existingId
          ? [finalSlug, existingId]
          : [finalSlug];

        const [result] = await connection.query(query, params);

        if (result[0].count === 0) {
          slugExists = false;
        } else {
          finalSlug = `${baseSlug}-${counter}`;
          counter++;
        }
      }

      return finalSlug;
    });
  }

  // Metode untuk soft delete
  static async softDeletePost(id) {
    try {
      const connection = await db.getConnection();

      // Soft delete post
      const [result] = await connection.execute(
        'UPDATE posts SET deleted_at = NOW() WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        connection.release();
        return null;
      }

      // Ambil post yang sudah di-soft delete
      const [rows] = await connection.execute(
        'SELECT p.*, u.username as author_name FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.id = ?',
        [id]
      );

      connection.release();

      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error soft deleting post:', error);
      throw error;
    }
  }

  // Metode untuk restore post
  static async restorePost(id) {
    try {
      const connection = await db.getConnection();

      // Restore post
      const [result] = await connection.execute(
        'UPDATE posts SET deleted_at = NULL WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        connection.release();
        return null;
      }

      // Ambil post yang sudah di-restore
      const [rows] = await connection.execute(
        'SELECT p.*, u.username as author_name FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.id = ?',
        [id]
      );

      connection.release();

      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error restoring post:', error);
      throw error;
    }
  }

  // Perbaikan metode untuk permanent delete
  static async deletePostPermanently(id) {
    try {
      const connection = await db.getConnection();

      // 1. Hapus relasi di tabel post_labels jika ada
      await connection.query(
        'DELETE FROM post_labels WHERE post_id = ?',
        [id]
      );

      // 2. Hapus post
      const [result] = await connection.query(
        'DELETE FROM posts WHERE id = ?',
        [id]
      );

      connection.release();

      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error permanently deleting post:', error);
      throw error;
    }
  }

  // Perbaikan metode untuk mendapatkan deleted posts
  static async getDeletedPosts(page = 1, limit = 10) {
    try {
      // Pastikan page dan limit adalah angka
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      const connection = await db.getConnection();

      // Gunakan query dengan nilai hardcoded untuk LIMIT dan OFFSET
      // Ini adalah workaround untuk masalah dengan prepared statements
      const query = `
        SELECT p.*, u.username as author_name
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.deleted_at IS NOT NULL
        ORDER BY p.deleted_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `;

      const [rows] = await connection.query(query);

      // Hitung total items untuk pagination
      const [countResult] = await connection.execute(
        'SELECT COUNT(*) as total FROM posts WHERE deleted_at IS NOT NULL'
      );

      connection.release();

      const totalItems = countResult[0].total;
      const totalPages = Math.ceil(totalItems / limitNum);

      return {
        data: rows,
        pagination: {
          totalItems,
          totalPages,
          currentPage: pageNum,
          limit: limitNum
        }
      };
    } catch (error) {
      console.error('Error getting deleted posts:', error);
      throw error;
    }
  }

  // Modifikasi metode findAll untuk hanya mengambil post aktif
  static async findAll(options = {}) {
    const { includeDeleted = false } = options;
    return executeQuery(async (connection) => {
      let query = 'SELECT * FROM posts';
      if (!includeDeleted) {
        query += ' WHERE deleted_at IS NULL';
      }
      const [rows] = await connection.query(query);
      return rows;
    });
  }

  static async findById(id) {
    return executeQuery(async (connection) => {
      try {
        // Query untuk post dan author
        const postQuery = `
          SELECT
            p.*,
            u.name as author_name,
            u.email as author_email
          FROM posts p
          LEFT JOIN users u ON p.author_id = u.id
          WHERE p.id = ?`;

        // Query untuk labels
        const labelQuery = `
          SELECT
            ul.id,
            ul.label
          FROM post_labels pl
          JOIN unique_labels ul ON pl.label_id = ul.id
          WHERE pl.post_id = ?`;

        // Eksekusi kedua query secara parallel
        const [[postResults], [labelResults]] = await Promise.all([
          connection.query(postQuery, [id]),
          connection.query(labelQuery, [id])
        ]);

        // Debug log
        logger.info('Post.findById query results:', {
          postId: id,
          postFound: !!postResults?.[0],
          labelCount: labelResults?.length
        });

        const post = postResults?.[0];
        if (!post) {
          logger.warn(`Post not found with id: ${id}`);
          return null;
        }

        // Format response dengan semua field yang diperlukan
        return {
          id: post.id,
          title: post.title || '',
          content: post.content || '',
          slug: post.slug || '',
          status: post.status || 'draft',
          publish_date: post.publish_date || null,
          created_at: post.created_at || new Date(),
          updated_at: post.updated_at || new Date(),
          author_id: post.author_id,
          author_name: post.author_name || '',
          author_email: post.author_email || '',
          image: post.image,
          excerpt: post.excerpt || '',
          is_featured: Boolean(post.is_featured),
          is_spotlight: Boolean(post.is_spotlight),
          version: post.version || 1,
          views: post.views || 0,
          labels: labelResults?.map(label => ({
            id: label.id,
            name: label.label
          })) || []
        };

      } catch (error) {
        logger.error('Error in Post.findById:', {
          error: error.message,
          stack: error.stack,
          postId: id
        });
        throw new Error(`Failed to find post: ${error.message}`);
      }
    });
  }

  static async update(id, data) {
    try {
      const {
        title,
        content,
        status,
        publish_date,
        image,
        excerpt,
        is_featured,
        is_spotlight,
        slug
      } = data;

      // Format datetime untuk MySQL
      const formattedPublishDate = publish_date
        ? moment(publish_date).format('YYYY-MM-DD HH:mm:ss')
        : null;

      const updateData = {
        title,
        content,
        status,
        publish_date: formattedPublishDate,
        image,
        excerpt,
        is_featured: is_featured === '1' || is_featured === true ? 1 : 0,
        is_spotlight: is_spotlight === '1' || is_spotlight === true ? 1 : 0,
        slug,
        updated_at: moment().format('YYYY-MM-DD HH:mm:ss')
      };

      // Filter out undefined values
      const filteredData = Object.fromEntries(
        Object.entries(updateData).filter(([_, v]) => v !== undefined)
      );

      const query = `
        UPDATE posts
        SET ?
        WHERE id = ?
      `;

      logger.info('Executing update query:', {
        postId: id,
        updateData: filteredData,
        query
      });

      const result = await executeQuery(query, [filteredData, id]);

      if (!result || result.affectedRows === 0) {
        throw new Error('Post not found or no changes made');
      }

      return id;
    } catch (error) {
      logger.error('Error updating post:', {
        error: error.message,
        stack: error.stack,
        postId: id,
        data
      });
      throw new Error(`Failed to update post: ${error.message}`);
    }
  }

  // Tambahkan method untuk public post
  static async getPublicPostById(id) {
    return executeQuery(async (connection) => {
      const query = `
        SELECT
          p.*,
          u.name as author_name,
          COUNT(DISTINCT l.id) as like_count,
          COUNT(DISTINCT c.id) as comment_count,
          GROUP_CONCAT(
            DISTINCT JSON_OBJECT(
              'id', ul.id,
              'label', ul.label
            )
          ) as labels
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments c ON p.id = c.post_id
        LEFT JOIN post_labels pl ON p.id = pl.post_id
        LEFT JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE p.id = ?
        AND p.status = 'published'
        AND p.deleted_at IS NULL
        GROUP BY p.id, u.name`;

      const [rows] = await connection.query(query, [id]);
      if (!rows.length) return null;

      return {
        ...rows[0],
        labels: rows[0].labels ? JSON.parse(`[${rows[0].labels}]`).filter(Boolean) : []
      };
    });
  }

  // Method untuk admin/writer
  static async getFullPostById(id) {
    return executeQuery(async (connection) => {
      const query = `
        SELECT
          p.*,
          u.name as author_name,
          COUNT(DISTINCT l.id) as like_count,
          COUNT(DISTINCT c.id) as comment_count,
          GROUP_CONCAT(
            DISTINCT JSON_OBJECT(
              'id', ul.id,
              'label', ul.label
            )
          ) as labels
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments c ON p.id = c.post_id
        LEFT JOIN post_labels pl ON p.id = pl.post_id
        LEFT JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE p.id = ?
        GROUP BY p.id, u.name`;

      const [rows] = await connection.query(query, [id]);
      if (!rows.length) return null;

      return {
        ...rows[0],
        labels: rows[0].labels ? JSON.parse(`[${rows[0].labels}]`).filter(Boolean) : []
      };
    });
  }

  static async getPublicPostBySlug(slug) {
    return executeQuery(async (connection) => {
      const query = `
        SELECT
          p.*,
          u.name as author_name,
          u.username as author_username,
          COUNT(DISTINCT l.id) as like_count,
          COUNT(DISTINCT c.id) as comment_count,
          GROUP_CONCAT(
            DISTINCT JSON_OBJECT(
              'id', ul.id,
              'label', ul.label
            )
          ) as labels
        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments c ON p.id = c.post_id
        LEFT JOIN post_labels pl ON p.id = pl.post_id
        LEFT JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE p.slug = ?
        AND p.status = 'published'
        AND p.deleted_at IS NULL
        GROUP BY p.id, u.name, u.username`;

      const [rows] = await connection.query(query, [slug]);

      if (!rows.length) {
        return null;
      }

      // Format post data dengan nama author yang lebih sesuai
      const post = {
        ...rows[0],
        labels: rows[0].labels ? JSON.parse(`[${rows[0].labels}]`).filter(Boolean) : [],
        author: {
          name: rows[0].author_name || rows[0].author_username || null
        }
      };

      // Hapus field yang tidak perlu
      delete post.author_name;
      delete post.author_username;
      delete post.author_email;

      // Ambil related posts
      const relatedPosts = await this.findRelated(post.id);

      return {
        ...post,
        related_posts: relatedPosts
      };
    });
  }

  static async updatePost(id, updateData) {
    return executeQuery(async (connection) => {
      // Validasi data
      if (!id) {
        throw new Error('Post ID is required');
      }

      // Siapkan query update
      let query = 'UPDATE posts SET ';
      const updateFields = [];
      const params = [];

      // Tambahkan field yang akan diupdate
      for (const [key, value] of Object.entries(updateData)) {
        if (value !== undefined) {
          updateFields.push(`${key} = ?`);
          params.push(value);
        }
      }

      // Tambahkan updated_at
      updateFields.push('updated_at = ?');
      params.push(new Date());

      // Gabungkan field update
      query += updateFields.join(', ');

      // Tambahkan kondisi WHERE
      query += ' WHERE id = ?';
      params.push(id);

      // Eksekusi query
      const [result] = await connection.query(query, params);

      // Cek apakah update berhasil
      if (result.affectedRows === 0) {
        throw new Error('Post not found or no changes made');
      }

      // Ambil post yang sudah diupdate
      return this.getFullPostById(id);
    });
  }

  // Fungsi untuk membuat post baru
  static async createPost(postData) {
    return executeQuery(async (connection) => {
      try {
        // Generate UUID untuk id post
        const postId = crypto.randomUUID(); // Pastikan crypto sudah diimpor

        // Siapkan data untuk insert
        const {
          title,
          content,
          status,
          user_id, // Ini adalah author_id
          publish_date,
          excerpt,
          is_featured,
          is_spotlight,
          image
        } = postData;

        // Generate slug dari title
        const slug = this.generateSlug(title);

        // Query untuk insert post
        const [result] = await connection.query(
          `INSERT INTO posts (id, title, content, image, publish_date, is_featured, is_spotlight, author_id, excerpt,
slug, status)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            postId, // Gunakan UUID yang digenerate
            title,
            content,
            image,
            publish_date,
            is_featured ? 1 : 0,
            is_spotlight ? 1 : 0,
            user_id, // Gunakan user_id sebagai author_id
            excerpt || '',
            slug,
            status
          ]
        );

        // Jika ada labels, tambahkan ke post_labels
        if (postData.labels) {
          let labelIds;

          // Cek apakah labels adalah string JSON atau array
          if (typeof postData.labels === 'string') {
            try {
              labelIds = JSON.parse(postData.labels);
            } catch (e) {
              console.error('Error parsing labels:', e);
              labelIds = [];
            }
          } else {
            labelIds = postData.labels;
          }

          // Jika labelIds adalah array dan tidak kosong
          if (Array.isArray(labelIds) && labelIds.length > 0) {
            // Siapkan values untuk batch insert
            const labelValues = labelIds.map(labelId => [postId, labelId]);

            // Siapkan placeholders
            const placeholders = labelIds.map(() => '(?, ?)').join(', ');

            // Flatten array untuk params
            const params = labelValues.flat();

            // Insert ke post_labels
            await connection.query(
              `INSERT INTO post_labels (post_id, label_id) VALUES ${placeholders}`,
              params
            );
          }
        }

        // Ambil post yang baru dibuat dengan labels
        return this.getFullPostById(postId);
      } catch (error) {
        console.error('Error in createPost:', error);
        throw error;
      }
    });
  }

  // Fungsi untuk generate slug
  static generateSlug(title) {
    return title
      .toLowerCase()
      .replace(/[^\w ]+/g, '')
      .replace(/ +/g, '-');
  }

  // Tambahkan metode untuk mengambil post terhapus berdasarkan user_id
  static async getDeletedPostsByUserId(userId, options = {}) {
    const { page = 1, limit = 10, search = '', includeLabels = false } = options;
    const offset = (page - 1) * limit;

    return executeQuery(async (connection) => {
      // Perbaiki query untuk menggunakan author_id bukan user_id
      let query = `
        SELECT p.*, u.name as author_name, u.username as author_username
        FROM posts p
        JOIN users u ON p.author_id = u.id
        WHERE p.author_id = ? AND p.deleted_at IS NOT NULL
      `;

      // Tambahkan kondisi pencarian jika ada
      const params = [userId];
      if (search) {
        query += ` AND (p.title LIKE ? OR p.content LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
      }

      // Tambahkan ordering dan limit
      query += ` ORDER BY p.deleted_at DESC LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), offset);

      // Eksekusi query
      const [posts] = await connection.query(query, params);

      // Hitung total post untuk pagination
      let countQuery = `
        SELECT COUNT(*) as total FROM posts
        WHERE author_id = ? AND deleted_at IS NOT NULL
      `;

      const countParams = [userId];
      if (search) {
        countQuery += ` AND (title LIKE ? OR content LIKE ?)`;
        countParams.push(`%${search}%`, `%${search}%`);
      }

      const [countResult] = await connection.query(countQuery, countParams);
      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      // Ambil labels untuk setiap post jika diminta
      if (includeLabels && posts.length > 0) {
        const postIds = posts.map(post => post.id);

        for (const post of posts) {
          try {
            const labels = await PostLabel.getLabelsForPost(post.id);
            post.labels = labels || [];
          } catch (error) {
            console.error(`Error fetching labels for post ${post.id}:`, error);
            post.labels = [];
          }
        }
      }

      // Format response
      const formattedPosts = posts.map(post => ({
        ...post,
        is_featured: !!post.is_featured,
        is_spotlight: !!post.is_spotlight,
        image: post.image ? formatImageUrl(post.image) : null,
        labels: post.labels || []
      }));

      return {
        posts: formattedPosts,
        pagination: {
          totalItems: total,
          totalPages,
          currentPage: parseInt(page),
          limit: parseInt(limit)
        }
      };
    });
  }
}

module.exports = Post;
