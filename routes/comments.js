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

// Mendapatkan semua komentar untuk post tertentu
router.get('/post/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const connection = await executeQuery(async (conn) => {
      // Dapatkan total komentar
      const [countResult] = await conn.query(
        `SELECT COUNT(*) as total FROM comments WHERE post_id = ? AND deleted_at IS NULL`,
        [postId]
      );
      const totalComments = countResult[0].total;
      const totalPages = Math.ceil(totalComments / limit);

      // Dapatkan komentar dengan informasi user
      const [commentsRaw] = await conn.query(
        `SELECT c.id, c.content, c.created_at, c.updated_at,
                u.id as user_id, u.name as user_name, u.profile_picture, u.role as user_role
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.post_id = ? AND c.deleted_at IS NULL
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        [postId, parseInt(limit), parseInt(offset)]
      );

      // Format profile_picture URL
      const comments = commentsRaw.map(comment => ({
        ...comment,
        profile_picture: formatProfilePicture(comment.profile_picture)
      }));

      return {
        comments,
        pagination: {
          totalComments,
          totalPages,
          currentPage: parseInt(page),
          limit: parseInt(limit)
        }
      };
    });

    res.json({
      success: true,
      data: connection
    });
  } catch (error) {
    logger.error('Error fetching comments:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil komentar',
      error: error.message
    });
  }
});

// Menambahkan komentar baru
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const { post_id, content } = req.body;
    const user_id = req.user.id;

    if (!post_id || !content) {
      return res.status(400).json({
        success: false,
        message: 'Post ID dan konten komentar diperlukan'
      });
    }

    // Validasi apakah post ada dan mengizinkan komentar
    const connection = await executeQuery(async (conn) => {
      // Cek apakah post ada dan mengizinkan komentar
      const [postResult] = await conn.query(
        `SELECT allow_comments FROM posts WHERE id = ? AND deleted_at IS NULL`,
        [post_id]
      );

      if (postResult.length === 0) {
        return { error: 'Post tidak ditemukan' };
      }

      if (postResult[0].allow_comments === 0) {
        return { error: 'Komentar tidak diizinkan untuk post ini' };
      }

      // Tambahkan komentar baru
      const commentId = crypto.randomUUID();
      await conn.query(
        `INSERT INTO comments (id, post_id, user_id, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), NOW())`,
        [commentId, post_id, user_id, content]
      );

      // Dapatkan komentar yang baru dibuat dengan informasi user
      const [newCommentRaw] = await conn.query(
        `SELECT c.id, c.content, c.created_at, c.updated_at,
                u.id as user_id, u.name as user_name, u.profile_picture, u.role as user_role
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.id = ?`,
        [commentId]
      );

      // Format profile_picture URL
      const newComment = {
        ...newCommentRaw[0],
        profile_picture: formatProfilePicture(newCommentRaw[0].profile_picture)
      };

      return { comment: newComment };
    });

    if (connection.error) {
      return res.status(400).json({
        success: false,
        message: connection.error
      });
    }

    res.status(201).json({
      success: true,
      message: 'Komentar berhasil ditambahkan',
      data: connection.comment
    });
  } catch (error) {
    logger.error('Error adding comment:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menambahkan komentar',
      error: error.message
    });
  }
});

// Mengedit komentar
router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const user_id = req.user.id;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Konten komentar diperlukan'
      });
    }

    const connection = await executeQuery(async (conn) => {
      // Cek apakah komentar ada dan milik user yang sedang login
      const [commentResult] = await conn.query(
        `SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL`,
        [id]
      );

      if (commentResult.length === 0) {
        return { error: 'Komentar tidak ditemukan' };
      }

      // Hanya pemilik komentar atau admin yang dapat mengedit
      if (commentResult[0].user_id !== user_id && req.user.role !== 'admin') {
        return { error: 'Anda tidak memiliki izin untuk mengedit komentar ini' };
      }

      // Update komentar
      await conn.query(
        `UPDATE comments SET content = ?, updated_at = NOW() WHERE id = ?`,
        [content, id]
      );

      // Dapatkan komentar yang diupdate dengan informasi user
      const [updatedCommentRaw] = await conn.query(
        `SELECT c.id, c.content, c.created_at, c.updated_at,
                u.id as user_id, u.name as user_name, u.profile_picture, u.role as user_role
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.id = ?`,
        [id]
      );

      // Format profile_picture URL
      const updatedComment = {
        ...updatedCommentRaw[0],
        profile_picture: formatProfilePicture(updatedCommentRaw[0].profile_picture)
      };

      return { comment: updatedComment };
    });

    if (connection.error) {
      return res.status(400).json({
        success: false,
        message: connection.error
      });
    }

    res.json({
      success: true,
      message: 'Komentar berhasil diperbarui',
      data: connection.comment
    });
  } catch (error) {
    logger.error('Error updating comment:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui komentar',
      error: error.message
    });
  }
});

// Menghapus komentar (soft delete)
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;

    const connection = await executeQuery(async (conn) => {
      // Cek apakah komentar ada dan milik user yang sedang login
      const [commentResult] = await conn.query(
        `SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL`,
        [id]
      );

      if (commentResult.length === 0) {
        return { error: 'Komentar tidak ditemukan' };
      }

      // Hanya pemilik komentar atau admin yang dapat menghapus
      if (commentResult[0].user_id !== user_id && req.user.role !== 'admin') {
        return { error: 'Anda tidak memiliki izin untuk menghapus komentar ini' };
      }

      // Soft delete komentar
      await conn.query(
        `UPDATE comments SET deleted_at = NOW() WHERE id = ?`,
        [id]
      );

      return { success: true };
    });

    if (connection.error) {
      return res.status(400).json({
        success: false,
        message: connection.error
      });
    }

    res.json({
      success: true,
      message: 'Komentar berhasil dihapus'
    });
  } catch (error) {
    logger.error('Error deleting comment:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus komentar',
      error: error.message
    });
  }
});

module.exports = router;
