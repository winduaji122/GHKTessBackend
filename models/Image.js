const { pool, executeQuery } = require('../config/databaseConfig');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');

class Image {
  /**
   * Membuat record gambar baru di database
   * @param {Object} imageData - Data gambar
   * @returns {Promise<Object>} - Data gambar yang disimpan
   */
  static async create(imageData) {
    try {
      const id = imageData.id || uuidv4();
      
      const query = `
        INSERT INTO images (
          id, original_filename, original_path, thumbnail_path, medium_path, 
          mime_type, size, width, height, user_id, post_id, storage_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        id,
        imageData.originalFilename,
        imageData.originalPath,
        imageData.thumbnailPath,
        imageData.mediumPath,
        imageData.mimeType,
        imageData.size,
        imageData.width,
        imageData.height,
        imageData.userId || null,
        imageData.postId || null,
        imageData.storageType || 'local'
      ];
      
      await executeQuery(query, params);
      
      return { id, ...imageData };
    } catch (error) {
      logger.error('Error creating image record:', error);
      throw error;
    }
  }
  
  /**
   * Mendapatkan data gambar berdasarkan ID
   * @param {string} id - ID gambar
   * @returns {Promise<Object|null>} - Data gambar
   */
  static async findById(id) {
    try {
      const query = 'SELECT * FROM images WHERE id = ?';
      const [rows] = await executeQuery(query, [id]);
      
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      logger.error(`Error finding image with ID ${id}:`, error);
      throw error;
    }
  }
  
  /**
   * Mendapatkan semua gambar untuk post tertentu
   * @param {string} postId - ID post
   * @returns {Promise<Array>} - Array data gambar
   */
  static async findByPostId(postId) {
    try {
      const query = 'SELECT * FROM images WHERE post_id = ? ORDER BY created_at DESC';
      const [rows] = await executeQuery(query, [postId]);
      
      return rows;
    } catch (error) {
      logger.error(`Error finding images for post ${postId}:`, error);
      throw error;
    }
  }
  
  /**
   * Mendapatkan semua gambar untuk user tertentu
   * @param {string} userId - ID user
   * @returns {Promise<Array>} - Array data gambar
   */
  static async findByUserId(userId) {
    try {
      const query = 'SELECT * FROM images WHERE user_id = ? ORDER BY created_at DESC';
      const [rows] = await executeQuery(query, [userId]);
      
      return rows;
    } catch (error) {
      logger.error(`Error finding images for user ${userId}:`, error);
      throw error;
    }
  }
  
  /**
   * Menghapus gambar berdasarkan ID
   * @param {string} id - ID gambar
   * @returns {Promise<boolean>} - Status keberhasilan
   */
  static async delete(id) {
    try {
      const query = 'DELETE FROM images WHERE id = ?';
      const [result] = await executeQuery(query, [id]);
      
      return result.affectedRows > 0;
    } catch (error) {
      logger.error(`Error deleting image ${id}:`, error);
      throw error;
    }
  }
  
  /**
   * Update data gambar
   * @param {string} id - ID gambar
   * @param {Object} updateData - Data yang akan diupdate
   * @returns {Promise<boolean>} - Status keberhasilan
   */
  static async update(id, updateData) {
    try {
      const allowedFields = [
        'original_filename', 'original_path', 'thumbnail_path', 'medium_path',
        'mime_type', 'size', 'width', 'height', 'post_id', 'storage_type'
      ];
      
      const updates = [];
      const values = [];
      
      for (const [key, value] of Object.entries(updateData)) {
        const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        
        if (allowedFields.includes(snakeKey)) {
          updates.push(`${snakeKey} = ?`);
          values.push(value);
        }
      }
      
      if (updates.length === 0) {
        return false;
      }
      
      values.push(id);
      
      const query = `UPDATE images SET ${updates.join(', ')} WHERE id = ?`;
      const [result] = await executeQuery(query, values);
      
      return result.affectedRows > 0;
    } catch (error) {
      logger.error(`Error updating image ${id}:`, error);
      throw error;
    }
  }
}

module.exports = Image;
