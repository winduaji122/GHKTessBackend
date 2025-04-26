const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/authMiddleware');
const { logger } = require('../utils/logger');
const { executeQuery } = require('../config/databaseConfig');
const crypto = require('crypto');

// Fungsi untuk memformat URL gambar profil
const formatProfilePicture = (profilePicture) => {
  if (!profilePicture) return null;

  // Jika URL sudah lengkap (dimulai dengan http:// atau https://), gunakan apa adanya
  if (profilePicture.startsWith('http://') || profilePicture.startsWith('https://')) {
    return profilePicture;
  }

  // Jika tidak, tambahkan base URL
  // Path yang benar adalah /uploads/ tanpa subfolder tambahan
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:5000';
  return `${baseUrl}/uploads/${profilePicture}`;
};

// Mendapatkan status like untuk post tertentu
router.get('/post/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user ? req.user.id : null;

    const connection = await executeQuery(async (conn) => {
      // Dapatkan total likes
      const [countResult] = await conn.query(
        `SELECT COUNT(*) as total FROM likes WHERE post_id = ?`,
        [postId]
      );
      const totalLikes = countResult[0].total;

      // Cek apakah user saat ini sudah like
      let userLiked = false;
      let userData = null;

      if (userId) {
        const [userLikeResult] = await conn.query(
          `SELECT l.id, u.id as user_id, u.name as user_name, u.profile_picture, u.role as user_role
           FROM likes l
           JOIN users u ON l.user_id = u.id
           WHERE l.post_id = ? AND l.user_id = ?`,
          [postId, userId]
        );

        userLiked = userLikeResult.length > 0;

        if (userLiked) {
          userData = {
            ...userLikeResult[0],
            profile_picture: formatProfilePicture(userLikeResult[0].profile_picture)
          };
        }
      }

      // Dapatkan 5 user terakhir yang menyukai post ini
      const [recentLikes] = await conn.query(
        `SELECT l.id, l.created_at, u.id as user_id, u.name as user_name, u.profile_picture, u.role as user_role
         FROM likes l
         JOIN users u ON l.user_id = u.id
         WHERE l.post_id = ?
         ORDER BY l.created_at DESC
         LIMIT 5`,
        [postId]
      );

      // Format profile_picture URL
      const formattedRecentLikes = recentLikes.map(like => ({
        ...like,
        profile_picture: formatProfilePicture(like.profile_picture)
      }));

      return {
        totalLikes,
        userLiked,
        userData,
        recentLikes: formattedRecentLikes
      };
    });

    res.json({
      success: true,
      data: connection
    });
  } catch (error) {
    logger.error('Error fetching like status:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil status like',
      error: error.message
    });
  }
});

// Menambahkan like
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const { post_id } = req.body;
    const user_id = req.user.id;

    if (!post_id) {
      return res.status(400).json({
        success: false,
        message: 'Post ID diperlukan'
      });
    }

    const connection = await executeQuery(async (conn) => {
      // Cek apakah post ada
      const [postResult] = await conn.query(
        `SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL`,
        [post_id]
      );

      if (postResult.length === 0) {
        return { error: 'Post tidak ditemukan' };
      }

      // Cek apakah user sudah like post ini
      const [existingLike] = await conn.query(
        `SELECT id FROM likes WHERE post_id = ? AND user_id = ?`,
        [post_id, user_id]
      );

      if (existingLike.length > 0) {
        return { error: 'Anda sudah menyukai post ini' };
      }

      // Tambahkan like baru
      const likeId = crypto.randomUUID();
      await conn.query(
        `INSERT INTO likes (id, post_id, user_id, created_at)
         VALUES (?, ?, ?, NOW())`,
        [likeId, post_id, user_id]
      );

      // Dapatkan total likes
      const [countResult] = await conn.query(
        `SELECT COUNT(*) as total FROM likes WHERE post_id = ?`,
        [post_id]
      );
      const totalLikes = countResult[0].total;

      // Dapatkan informasi user
      const [userResult] = await conn.query(
        `SELECT id as user_id, name as user_name, profile_picture, role as user_role
         FROM users
         WHERE id = ?`,
        [user_id]
      );

      const userData = {
        ...userResult[0],
        profile_picture: formatProfilePicture(userResult[0].profile_picture)
      };

      // Dapatkan 5 user terakhir yang menyukai post ini
      const [recentLikes] = await conn.query(
        `SELECT l.id, l.created_at, u.id as user_id, u.name as user_name, u.profile_picture, u.role as user_role
         FROM likes l
         JOIN users u ON l.user_id = u.id
         WHERE l.post_id = ?
         ORDER BY l.created_at DESC
         LIMIT 5`,
        [post_id]
      );

      // Format profile_picture URL
      const formattedRecentLikes = recentLikes.map(like => ({
        ...like,
        profile_picture: formatProfilePicture(like.profile_picture)
      }));

      return {
        likeId,
        totalLikes,
        userLiked: true,
        userData,
        recentLikes: formattedRecentLikes
      };
    });

    if (connection.error) {
      return res.status(400).json({
        success: false,
        message: connection.error
      });
    }

    res.status(201).json({
      success: true,
      message: 'Like berhasil ditambahkan',
      data: connection
    });
  } catch (error) {
    logger.error('Error adding like:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menambahkan like',
      error: error.message
    });
  }
});

// Menghapus like
router.delete('/:postId', isAuthenticated, async (req, res) => {
  try {
    const { postId } = req.params;
    const user_id = req.user.id;

    const connection = await executeQuery(async (conn) => {
      // Cek apakah like ada
      const [likeResult] = await conn.query(
        `SELECT id FROM likes WHERE post_id = ? AND user_id = ?`,
        [postId, user_id]
      );

      if (likeResult.length === 0) {
        return { error: 'Anda belum menyukai post ini' };
      }

      // Hapus like
      await conn.query(
        `DELETE FROM likes WHERE post_id = ? AND user_id = ?`,
        [postId, user_id]
      );

      // Dapatkan total likes
      const [countResult] = await conn.query(
        `SELECT COUNT(*) as total FROM likes WHERE post_id = ?`,
        [postId]
      );
      const totalLikes = countResult[0].total;

      // Dapatkan 5 user terakhir yang menyukai post ini
      const [recentLikes] = await conn.query(
        `SELECT l.id, l.created_at, u.id as user_id, u.name as user_name, u.profile_picture, u.role as user_role
         FROM likes l
         JOIN users u ON l.user_id = u.id
         WHERE l.post_id = ?
         ORDER BY l.created_at DESC
         LIMIT 5`,
        [postId]
      );

      // Format profile_picture URL
      const formattedRecentLikes = recentLikes.map(like => ({
        ...like,
        profile_picture: formatProfilePicture(like.profile_picture)
      }));

      return {
        totalLikes,
        userLiked: false,
        userData: null,
        recentLikes: formattedRecentLikes
      };
    });

    if (connection.error) {
      return res.status(400).json({
        success: false,
        message: connection.error
      });
    }

    res.json({
      success: true,
      message: 'Like berhasil dihapus',
      data: connection
    });
  } catch (error) {
    logger.error('Error removing like:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus like',
      error: error.message
    });
  }
});

module.exports = router;
