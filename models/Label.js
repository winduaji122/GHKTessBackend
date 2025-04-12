const { logger } = require('../utils/logger');
const { executeQuery } = require('../config/databaseConfig');

class Label {
  constructor(id, label) {
    this.id = parseInt(id);
    this.label = label;
  }

  static async create(label) {
    return executeQuery(async (connection) => {
      try {
        const [result] = await connection.query(
          'INSERT INTO unique_labels (label) VALUES (?)',
          [label]
        );
        const id = result.insertId;
        logger.info(`Created new label: ${label} with ID: ${id}`);
        return new Label(id, label);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          logger.warn(`Attempted to create duplicate label: ${label}`);
          throw new Error('Label must be unique');
        }
        logger.error('Error creating label:', error);
        throw error;
      }
    });
  }

  static async findAll() {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT id, label FROM unique_labels ORDER BY label');
      logger.info(`Retrieved ${rows.length} labels`);
      return rows.map(row => new Label(row.id, row.label));
    });
  }

  static async findById(id) {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM unique_labels WHERE id = ?', [id]);
      if (rows[0]) {
        logger.info(`Found label with ID: ${id}`);
        return new Label(rows[0].id, rows[0].label);
      } else {
        logger.warn(`No label found with ID: ${id}`);
        return null;
      }
    });
  }

  static async findByName(label) {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM unique_labels WHERE label = ?', [label]);
      if (rows[0]) {
        logger.info(`Found label: ${label}`);
        return new Label(rows[0].id, rows[0].label);
      } else {
        logger.info(`No label found with name: ${label}`);
        return null;
      }
    });
  }

  static async update(id, label) {
    return executeQuery(async (connection) => {
      try {
        const [result] = await connection.query(
          'UPDATE unique_labels SET label = ? WHERE id = ?',
          [label, id]
        );
        if (result.affectedRows === 0) {
          logger.warn(`Attempted to update non-existent label with ID: ${id}`);
          throw new Error('Label not found');
        }
        logger.info(`Updated label with ID: ${id} to: ${label}`);
        return new Label(id, label);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          logger.warn(`Attempted to update to duplicate label: ${label}`);
          throw new Error('Label must be unique');
        }
        logger.error('Error updating label:', error);
        throw error;
      }
    });
  }

  static async delete(id) {
    return executeQuery(async (connection) => {
      try {
        // Hapus semua asosiasi di post_labels
        await connection.query('DELETE FROM post_labels WHERE label_id = ?', [id]);
        
        // Hapus label dari unique_labels
        const [result] = await connection.query('DELETE FROM unique_labels WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
          logger.warn(`Attempted to delete non-existent label with ID: ${id}`);
          throw new Error('Label not found');
        }
        
        logger.info(`Deleted label with ID: ${id}`);
        return true;
      } catch (error) {
        logger.error('Error deleting label:', error);
        throw error;
      }
    });
  }

  static async findByPostId(postId) {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query(`
        SELECT ul.id, ul.label 
        FROM unique_labels ul
        JOIN post_labels pl ON ul.id = pl.label_id
        WHERE pl.post_id = ?
      `, [postId]);
      logger.info(`Retrieved ${rows.length} labels for post ID: ${postId}`);
      return rows.map(row => new Label(row.id, row.label));
    });
  }

  static async addToPost(postId, labelIds) {
    return executeQuery(async (connection) => {
      const validLabelIds = labelIds
        .map(id => parseInt(id))
        .filter(id => !isNaN(id));
      
      const values = validLabelIds.map(labelId => [postId, labelId]);
      await connection.query(
        'INSERT IGNORE INTO post_labels (post_id, label_id) VALUES ?', 
        [values]
      );
      logger.info(`Added ${validLabelIds.length} labels to post ID: ${postId}`);
    });
  }

  static async removeFromPost(postId, labelId) {
    return executeQuery(async (connection) => {
      if (labelId) {
        await connection.query('DELETE FROM post_labels WHERE post_id = ? AND label_id = ?', [postId, labelId]);
        logger.info(`Removed label ID: ${labelId} from post ID: ${postId}`);
      } else {
        await connection.query('DELETE FROM post_labels WHERE post_id = ?', [postId]);
        logger.info(`Removed all labels from post ID: ${postId}`);
      }
    });
  }

  static async getPopularLabels(limit = 10) {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query(`
        SELECT ul.id, ul.label, COUNT(pl.post_id) as post_count
        FROM unique_labels ul
        LEFT JOIN post_labels pl ON ul.id = pl.label_id
        GROUP BY ul.id
        ORDER BY post_count DESC
        LIMIT ?
      `, [parseInt(limit)]);
      logger.info(`Retrieved ${rows.length} popular labels`);
      return rows.map(row => ({...new Label(row.id, row.label), postCount: parseInt(row.post_count)}));
    });
  }
}

module.exports = Label;