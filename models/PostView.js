const { v4: uuidv4 } = require('uuid');
const { executeQuery } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');

class PostView {
  /**
   * Menambahkan view baru untuk post
   * @param {string} postId - ID post yang dilihat
   * @param {string|null} userId - ID user yang melihat (null jika tidak login)
   * @param {string} ip - IP address user
   * @returns {Promise<boolean>} - true jika berhasil
   */
  static async addView(postId, userId, ip) {
    return executeQuery(async (connection) => {
      try {
        // Log untuk debugging
        logger.info(`Attempting to add view for post ${postId} by ${userId || 'anonymous'} from IP ${ip}`);

        // Validasi input
        if (!postId) {
          logger.error('Invalid postId provided to addView');
          return false;
        }

        if (!ip) {
          logger.warn('No IP address provided to addView, using fallback');
          ip = '0.0.0.0'; // Fallback IP jika tidak ada
        }

        // Cek apakah post ada
        const [postExists] = await connection.query(
          'SELECT id FROM posts WHERE id = ?',
          [postId]
        );

        if (postExists.length === 0) {
          logger.error(`Post with ID ${postId} not found`);
          return false;
        }

        // Cek apakah sudah ada view dari user/IP ini dalam 24 jam terakhir
        let existingViewsQuery;
        let queryParams;

        if (userId) {
          // Jika user login, cek berdasarkan user_id
          existingViewsQuery = `
            SELECT id FROM post_views
            WHERE post_id = ?
            AND user_id = ?
            AND viewed_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`;
          queryParams = [postId, userId];
        } else {
          // Jika user tidak login, cek berdasarkan IP
          existingViewsQuery = `
            SELECT id FROM post_views
            WHERE post_id = ?
            AND viewer_ip = ?
            AND viewed_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`;
          queryParams = [postId, ip];
        }

        const [existingViews] = await connection.query(existingViewsQuery, queryParams);
        logger.info(`Found ${existingViews.length} existing views for post ${postId}`);

        // Jika belum ada view dalam 24 jam terakhir, tambahkan view baru
        if (existingViews.length === 0) {
          // Buat ID unik untuk view baru
          const viewId = uuidv4();

          try {
            // Tambahkan view baru ke tabel post_views
            await connection.query(
              'INSERT INTO post_views (id, post_id, user_id, viewer_ip, viewed_at) VALUES (?, ?, ?, ?, NOW())',
              [viewId, postId, userId || null, ip]
            );

            logger.info(`View added to post_views for post ${postId}`);

            // Update juga kolom views di tabel posts
            await connection.query(
              'UPDATE posts SET views = views + 1 WHERE id = ?',
              [postId]
            );

            logger.info(`Views count incremented in posts table for post ${postId}`);

            // Verifikasi bahwa view berhasil ditambahkan
            const [verifyView] = await connection.query(
              'SELECT * FROM post_views WHERE id = ?',
              [viewId]
            );

            if (verifyView.length > 0) {
              logger.info(`New view verified and added for post ${postId} by ${userId || 'anonymous'} from IP ${ip}`);
              return true;
            } else {
              logger.error(`Failed to verify new view for post ${postId}`);
              return false;
            }
          } catch (insertError) {
            logger.error(`Error inserting view for post ${postId}:`, insertError);

            // Coba update views di tabel posts meskipun insert ke post_views gagal
            try {
              await connection.query(
                'UPDATE posts SET views = views + 1 WHERE id = ?',
                [postId]
              );
              logger.info(`Views count incremented in posts table despite insert error for post ${postId}`);
              return true;
            } catch (updateError) {
              logger.error(`Error updating views count for post ${postId}:`, updateError);
              return false;
            }
          }
        }

        logger.info(`View already exists for post ${postId} by ${userId || 'anonymous'} from IP ${ip}`);
        return false;
      } catch (error) {
        logger.error('Error adding view:', error);
        throw error;
      }
    });
  }

  /**
   * Mendapatkan jumlah views untuk post
   * @param {string} postId - ID post
   * @returns {Promise<number>} - Jumlah views
   */
  static async getViewCount(postId) {
    return executeQuery(async (connection) => {
      try {
        // Ambil jumlah views dari tabel posts (lebih efisien)
        const [result] = await connection.query(
          'SELECT views FROM posts WHERE id = ?',
          [postId]
        );

        return result.length > 0 ? result[0].views : 0;
      } catch (error) {
        logger.error('Error getting view count:', error);
        throw error;
      }
    });
  }

  /**
   * Mendapatkan statistik views untuk post
   * @param {string} postId - ID post
   * @returns {Promise<Object>} - Statistik views
   */
  static async getViewStats(postId) {
    return executeQuery(async (connection) => {
      try {
        // Ambil statistik views
        const [totalViews] = await connection.query(
          'SELECT views FROM posts WHERE id = ?',
          [postId]
        );

        // Ambil jumlah unique viewers (berdasarkan IP)
        const [uniqueViewers] = await connection.query(
          'SELECT COUNT(DISTINCT viewer_ip) as unique_viewers FROM post_views WHERE post_id = ?',
          [postId]
        );

        // Ambil jumlah views per hari dalam 7 hari terakhir
        const [dailyViews] = await connection.query(
          `SELECT
            DATE(viewed_at) as date,
            COUNT(*) as count
           FROM post_views
           WHERE post_id = ?
           AND viewed_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
           GROUP BY DATE(viewed_at)
           ORDER BY date ASC`,
          [postId]
        );

        return {
          total_views: totalViews.length > 0 ? totalViews[0].views : 0,
          unique_viewers: uniqueViewers.length > 0 ? uniqueViewers[0].unique_viewers : 0,
          daily_views: dailyViews
        };
      } catch (error) {
        logger.error('Error getting view stats:', error);
        throw error;
      }
    });
  }
}

module.exports = PostView;
