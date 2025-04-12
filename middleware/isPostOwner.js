const { executeQuery } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');

const isPostOwner = async (req, res, next) => {
  try {
    if (req.user.is_admin === 1) {
      return next();
    }
    
    const postId = req.params.id;
    const post = await executeQuery(async (connection) => {
      const [result] = await connection.query('SELECT * FROM posts WHERE id = ?', [postId]);
      return result[0];
    });
    
    if (!post) {
      return res.status(404).json({ message: 'Post tidak ditemukan' });
    }
    
    if (post.author_id !== req.user.id) {
      return res.status(403).json({ message: 'Anda tidak memiliki izin untuk mengedit post ini' });
    }
    
    next();
  } catch (error) {
    logger.error('Error in isPostOwner middleware:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server internal' });
  }
};

module.exports = isPostOwner;