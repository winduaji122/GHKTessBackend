const { executeQuery } = require('../config/databaseConfig');

async function slugAlreadyExists(slug, postId = null) {
  try {
    return await executeQuery(async (connection) => {
      let query = 'SELECT COUNT(*) as count FROM posts WHERE slug = ?';
      let params = [slug];

      if (postId) {
        query += ' AND id != ?';
        params.push(postId);
      }

      const [rows] = await connection.query(query, params);
      return rows[0].count > 0;
    });
  } catch (error) {
    console.error('Error checking slug existence:', error);
    throw error;
  }
}

module.exports = { slugAlreadyExists };