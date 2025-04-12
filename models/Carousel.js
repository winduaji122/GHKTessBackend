const { executeQuery } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');

class Carousel {
  static async getAllSlides() {
    try {
      return await executeQuery(
        `SELECT * FROM carousel_slides WHERE active = 1 ORDER BY sort_order ASC`
      );
    } catch (error) {
      logger.error('Error getting carousel slides:', error);
      throw error;
    }
  }

  static async getAllSlidesAdmin() {
    try {
      return await executeQuery(
        `SELECT * FROM carousel_slides ORDER BY sort_order ASC`
      );
    } catch (error) {
      logger.error('Error getting admin carousel slides:', error);
      throw error;
    }
  }

  static async getSlideById(id) {
    try {
      const rows = await executeQuery(
        `SELECT * FROM carousel_slides WHERE id = ?`,
        [id]
      );
      return rows[0];
    } catch (error) {
      logger.error(`Error getting carousel slide with id ${id}:`, error);
      throw error;
    }
  }

  static async createSlide(slideData) {
    try {
      const { title, description, image_url, link, button_text, active, sort_order } = slideData;

      const result = await executeQuery(
        `INSERT INTO carousel_slides
        (title, description, image_url, link, button_text, active, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [title, description, image_url, link, button_text, active || 1, sort_order || 0]
      );

      return { id: result.insertId, ...slideData };
    } catch (error) {
      logger.error('Error creating carousel slide:', error);
      throw error;
    }
  }

  static async updateSlide(id, slideData) {
    try {
      const { title, description, image_url, link, button_text, active, sort_order } = slideData;

      await executeQuery(
        `UPDATE carousel_slides
        SET title = ?, description = ?, image_url = ?, link = ?,
        button_text = ?, active = ?, sort_order = ?, updated_at = NOW()
        WHERE id = ?`,
        [title, description, image_url, link, button_text, active, sort_order, id]
      );

      return { id, ...slideData };
    } catch (error) {
      logger.error(`Error updating carousel slide with id ${id}:`, error);
      throw error;
    }
  }

  static async deleteSlide(id) {
    try {
      await executeQuery('DELETE FROM carousel_slides WHERE id = ?', [id]);
      return { id };
    } catch (error) {
      logger.error(`Error deleting carousel slide with id ${id}:`, error);
      throw error;
    }
  }

  static async updateSlidesOrder(slidesOrder) {
    try {
      // Gunakan executeQuery untuk setiap slide
      for (const slide of slidesOrder) {
        await executeQuery(
          'UPDATE carousel_slides SET sort_order = ? WHERE id = ?',
          [slide.sort_order, slide.id]
        );
      }
      return true;
    } catch (error) {
      logger.error('Error updating carousel slides order:', error);
      throw error;
    }
  }
}

module.exports = Carousel;
