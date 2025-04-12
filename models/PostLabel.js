const { logger } = require('../utils/logger');
const { executeQuery } = require('../config/databaseConfig');

class PostLabel {
  constructor(postId, labelId) {
    this.post_id = postId;  // varchar(36) - UUID
    this.label_id = parseInt(labelId); // int
  }

  static async create(postId, labelId) {
    if (!postId || !labelId) {
      throw new Error('PostId dan LabelId diperlukan');
    }
    return executeQuery(async (connection) => {
      const query = 'INSERT INTO post_labels (post_id, label_id) VALUES (?, ?)';
      await connection.query(query, [postId, labelId]);
      return new PostLabel(postId, labelId);
    });
  }

  static async createMultiple(postId, labelIds) {
    if (!postId || !Array.isArray(labelIds)) {
      throw new Error('PostId dan array labelIds diperlukan');
    }

    return executeQuery(async (connection) => {
      // Pastikan semua label_id adalah integer
      const validLabelIds = labelIds
        .map(id => parseInt(id))
        .filter(id => !isNaN(id));

      if (validLabelIds.length === 0) {
        logger.warn('Tidak ada label valid untuk ditambahkan');
        return;
      }

      // Validasi bahwa labels exist
      const [existingLabels] = await connection.query(
        'SELECT id FROM unique_labels WHERE id IN (?)',
        [validLabelIds]
      );

      if (existingLabels.length !== validLabelIds.length) {
        throw new Error('Beberapa label tidak ditemukan');
      }

      const values = validLabelIds.map(labelId => [postId, labelId]);
      await connection.query(
        'INSERT INTO post_labels (post_id, label_id) VALUES ?',
        [values]
      );

      logger.info(`Added ${values.length} labels to post ${postId}`);
    });
  }

  static async findByPostId(postId) {
    return executeQuery(async (connection) => {
      const query = `
        SELECT pl.post_id, pl.label_id, ul.label 
        FROM post_labels pl 
        JOIN unique_labels ul ON pl.label_id = ul.id 
        WHERE pl.post_id = ?
        ORDER BY ul.label
      `;
      const [rows] = await connection.query(query, [postId]);
      return rows.map(row => ({
        postId: row.post_id,
        labelId: row.label_id,
        label: row.label
      }));
    });
  }

  static async findByLabelId(labelId) {
    return executeQuery(async (connection) => {
      const query = 'SELECT * FROM post_labels WHERE label_id = ?';
      const [rows] = await connection.query(query, [labelId]);
      return rows.map(row => new PostLabel(row.post_id, row.label_id));
    });
  }

  static async delete(postId, labelId) {
    return executeQuery(async (connection) => {
      const query = 'DELETE FROM post_labels WHERE post_id = ? AND label_id = ?';
      const [result] = await connection.query(query, [postId, labelId]);
      return result.affectedRows > 0;
    });
  }

  static async deleteAllForPost(postId) {
    return executeQuery(async (connection) => {
      const query = 'DELETE FROM post_labels WHERE post_id = ?';
      const [result] = await connection.query(query, [postId]);
      logger.info(`Deleted ${result.affectedRows} labels from post ${postId}`);
      return result.affectedRows;
    });
  }

  static async deleteAllForLabel(labelId) {
    return executeQuery(async (connection) => {
      const query = 'DELETE FROM post_labels WHERE label_id = ?';
      const [result] = await connection.query(query, [labelId]);
      return result.affectedRows;
    });
  }

  static async getLabelsForPost(postId) {
    return executeQuery(async (connection) => {
      const query = `
        SELECT ul.id, ul.label, ul.parent_id
        FROM post_labels pl
        JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE pl.post_id = ?
        ORDER BY ul.label
      `;
      const [rows] = await connection.query(query, [postId]);
      logger.info(`Retrieved ${rows.length} labels for post ${postId}`);
      return rows;
    });
  }

  static async addLabelsToPost(postId, labelIds) {
    if (!postId) {
      throw new Error('PostId diperlukan');
    }

    // Pastikan labelIds adalah array dan valid
    let parsedLabelIds;
    try {
      parsedLabelIds = typeof labelIds === 'string' ? 
        JSON.parse(labelIds) : labelIds;
      
      if (!Array.isArray(parsedLabelIds)) {
        throw new Error('labelIds harus berupa array');
      }

      // Filter dan validasi label ID - hanya terima format number
      parsedLabelIds = parsedLabelIds
        .map(id => parseInt(id))
        .filter(id => !isNaN(id));
      
      if (parsedLabelIds.length === 0) {
        logger.warn('Tidak ada label valid untuk ditambahkan');
        return;
      }
    } catch (error) {
      logger.error('Error parsing labelIds:', error);
      throw new Error('Format labelIds tidak valid');
    }

    return executeQuery(async (connection) => {
      try {
        // Validasi bahwa label ID ada di tabel unique_labels
        const [existingLabels] = await connection.query(
          'SELECT id FROM unique_labels WHERE id IN (?)',
          [parsedLabelIds]
        );

        if (existingLabels.length !== parsedLabelIds.length) {
          throw new Error('Beberapa label ID tidak ditemukan di database');
        }

        const query = 'INSERT INTO post_labels (post_id, label_id) VALUES ?';
        const values = parsedLabelIds.map(labelId => [postId, labelId]);
        
        logger.info(`Adding labels to post ${postId}:`, parsedLabelIds);
        await connection.query(query, [values]);
      } catch (error) {
        logger.error(`Error adding labels to post ${postId}:`, error);
        throw error;
      }
    });
  }

  static async removeAllFromPost(postId) {
    return this.deleteAllForPost(postId);
  }

  static async updateLabelsForPost(postId, labelIds) {
    return executeQuery(async (connection) => {
      try {
        await connection.query(
          'DELETE FROM post_labels WHERE post_id = ?', 
          [postId]
        );

        if (labelIds) {
          let parsedLabelIds;
          try {
            parsedLabelIds = typeof labelIds === 'string' ? 
              JSON.parse(labelIds) : labelIds;
          } catch (error) {
            logger.error('Error parsing labelIds:', error);
            throw new Error('Format labelIds tidak valid');
          }

          if (Array.isArray(parsedLabelIds) && parsedLabelIds.length > 0) {
            // Konversi semua ID ke format number
            const validLabelIds = parsedLabelIds
              .map(id => parseInt(id))
              .filter(id => !isNaN(id));

            if (validLabelIds.length > 0) {
              const values = validLabelIds.map(labelId => [postId, labelId]);
              await connection.query(
                'INSERT INTO post_labels (post_id, label_id) VALUES ?',
                [values]
              );
            }
          }
        }
      } catch (error) {
        logger.error(`Error updating labels for post ${postId}:`, error);
        throw error;
      }
    });
  }

  static async updatePostLabels(postId, labelIds) {
    return executeQuery(async (connection) => {
      // Hapus semua label yang ada untuk post ini
      await connection.query('DELETE FROM post_labels WHERE post_id = ?', [postId]);
      
      // Jika tidak ada label baru, selesai
      if (!labelIds || labelIds.length === 0) {
        return;
      }
      
      // Siapkan query untuk insert batch
      const insertValues = labelIds.map(labelId => [postId, labelId]);
      const placeholders = labelIds.map(() => '(?, ?)').join(', ');
      
      // Flatten array untuk params
      const params = insertValues.flat();
      
      // Insert label baru
      const query = `INSERT INTO post_labels (post_id, label_id) VALUES ${placeholders}`;
      await connection.query(query, params);
    });
  }
}

module.exports = PostLabel;