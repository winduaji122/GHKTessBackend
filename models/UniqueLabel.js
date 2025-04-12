const { logger } = require('../utils/logger');
const { executeQuery } = require('../config/databaseConfig');

class UniqueLabel {
  constructor(id, label, parentId = null) {
    this.id = parseInt(id);
    this.label = label;
    this.parentId = parentId ? parseInt(parentId) : null;
  }

  static validateLabel(label) {
    if (!label || typeof label !== 'string' || label.trim() === '') {
      logger.error('Invalid label:', label);
      throw new Error('Label harus berupa string yang tidak kosong');
    }
    if (label.length > 100) {
      logger.error('Label too long:', label);
      throw new Error('Label tidak boleh lebih dari 100 karakter');
    }
    return label.trim();
  }

  static async create(label, parentId = null) {
    const validatedLabel = this.validateLabel(label);
    return executeQuery(async (connection) => {
      const query = 'INSERT INTO unique_labels (label, parent_id) VALUES (?, ?)';
      const [result] = await connection.query(query, [validatedLabel, parentId]);
      const id = result.insertId;
      logger.info(`Created new unique label: ${validatedLabel} with ID: ${id}`);
      return new UniqueLabel(id, validatedLabel, parentId);
    });
  }

  static async findAll() {
    return executeQuery(async (connection) => {
      const query = `
        SELECT l.*, p.label as parent_label 
        FROM unique_labels l 
        LEFT JOIN unique_labels p ON l.parent_id = p.id 
        ORDER BY l.label
      `;
      const [rows] = await connection.query(query);
      logger.info(`Retrieved ${rows.length} unique labels`);
      return rows.map(row => new UniqueLabel(row.id, row.label, row.parent_id));
    });
  }

  static async findById(id) {
    if (!id || isNaN(parseInt(id))) {
      logger.error('Invalid ID for findById:', id);
      throw new Error('ID harus berupa number yang valid');
    }
    return executeQuery(async (connection) => {
      const query = `
        SELECT l.*, p.label as parent_label 
        FROM unique_labels l 
        LEFT JOIN unique_labels p ON l.parent_id = p.id 
        WHERE l.id = ?
      `;
      const [rows] = await connection.query(query, [parseInt(id)]);
      if (!rows[0]) {
        logger.warn(`No unique label found with ID: ${id}`);
        return null;
      }
      logger.info(`Found unique label with ID: ${id}`);
      return new UniqueLabel(rows[0].id, rows[0].label, rows[0].parent_id);
    });
  }

  static async findByName(label) {
    const validatedLabel = this.validateLabel(label);
    return executeQuery(async (connection) => {
      const query = 'SELECT * FROM unique_labels WHERE label = ?';
      const [rows] = await connection.query(query, [validatedLabel]);
      if (rows[0]) {
        logger.info(`Found unique label: ${validatedLabel}`);
      } else {
        logger.info(`No unique label found with name: ${validatedLabel}`);
      }
      return rows[0] ? new UniqueLabel(rows[0].id, rows[0].label) : null;
    });
  }

  static async update(id, label) {
    if (!id || isNaN(parseInt(id))) {
      logger.error('Invalid ID for update:', id);
      throw new Error('ID harus berupa number yang valid');
    }
    const validatedLabel = this.validateLabel(label);
    return executeQuery(async (connection) => {
      const query = 'UPDATE unique_labels SET label = ? WHERE id = ?';
      const [result] = await connection.query(query, [validatedLabel, parseInt(id)]);
      if (result.affectedRows === 0) {
        logger.warn(`No unique label found to update with ID: ${id}`);
        throw new Error('Unique label not found');
      }
      logger.info(`Updated unique label with ID: ${id} to: ${validatedLabel}`);
      return new UniqueLabel(parseInt(id), validatedLabel);
    });
  }

  static async delete(id) {
    if (!id || isNaN(parseInt(id))) {
      logger.error('Invalid ID for delete:', id);
      throw new Error('ID harus berupa number yang valid');
    }
    return executeQuery(async (connection) => {
      const deletePostLabelsQuery = 'DELETE FROM post_labels WHERE label_id = ?';
      const deleteLabelQuery = 'DELETE FROM unique_labels WHERE id = ?';
      await connection.query(deletePostLabelsQuery, [id]);
      const [result] = await connection.query(deleteLabelQuery, [id]);
      if (result.affectedRows === 0) {
        logger.warn(`No unique label found to delete with ID: ${id}`);
        throw new Error('Unique label not found');
      }
      logger.info(`Deleted unique label with ID: ${id}`);
      return true;
    });
  }

  static async findOrCreate(label) {
    const validatedLabel = this.validateLabel(label);
    return executeQuery(async (connection) => {
      let uniqueLabel = await this.findByName(validatedLabel);
      if (!uniqueLabel) {
        logger.info(`Creating new unique label: ${validatedLabel}`);
        uniqueLabel = await this.create(validatedLabel);
      } else {
        logger.info(`Found existing unique label: ${validatedLabel}`);
      }
      return uniqueLabel;
    });
  }

  static async getLabelsForPost(postId) {
    if (!postId || typeof postId !== 'string') {
      logger.error('Invalid post ID for getLabelsForPost:', postId);
      throw new Error('Post ID harus berupa string yang valid');
    }
    return executeQuery(async (connection) => {
      const query = `
        SELECT ul.id, ul.label, ul.parent_id
        FROM unique_labels ul 
        JOIN post_labels pl ON ul.id = pl.label_id 
        WHERE pl.post_id = ?
        ORDER BY ul.label
      `;
      const [rows] = await connection.query(query, [postId]);
      logger.info(`Retrieved ${rows.length} labels for post ID: ${postId}`);
      return rows.map(row => new UniqueLabel(row.id, row.label, row.parent_id));
    });
  }

  static async getChildLabels(parentId) {
    return executeQuery(async (connection) => {
      const query = 'SELECT * FROM unique_labels WHERE parent_id = ? ORDER BY label';
      const [rows] = await connection.query(query, [parentId]);
      return rows.map(row => new UniqueLabel(row.id, row.label, row.parent_id));
    });
  }
}

module.exports = UniqueLabel;