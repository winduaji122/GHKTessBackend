const { executeQuery } = require('../config/databaseConfig');

class StaticPage {
  // Get all static pages
  static async getAll() {
    try {
      const rows = await executeQuery(`
        SELECT * FROM static_pages
        ORDER BY title ASC
      `);
      return rows;
    } catch (error) {
      console.error('Error in StaticPage.getAll:', error);
      throw error;
    }
  }

  // Get static page by ID
  static async getById(id) {
    try {
      const rows = await executeQuery(`
        SELECT * FROM static_pages
        WHERE id = ?
      `, [id]);
      return rows[0];
    } catch (error) {
      console.error('Error in StaticPage.getById:', error);
      throw error;
    }
  }

  // Get static page by slug
  static async getBySlug(slug) {
    try {
      const rows = await executeQuery(`
        SELECT * FROM static_pages
        WHERE slug = ?
      `, [slug]);
      return rows[0];
    } catch (error) {
      console.error('Error in StaticPage.getBySlug:', error);
      throw error;
    }
  }

  // Create new static page
  static async create(pageData) {
    try {
      const { title, slug, content, is_published, show_in_footer, footer_section, external_link } = pageData;

      const result = await executeQuery(`
        INSERT INTO static_pages (
          title,
          slug,
          content,
          is_published,
          show_in_footer,
          footer_section,
          external_link,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `, [
        title,
        slug,
        content,
        is_published ? 1 : 0,
        show_in_footer ? 1 : 0,
        footer_section || 'main',
        external_link || null
      ]);

      return { id: result.insertId, ...pageData };
    } catch (error) {
      console.error('Error in StaticPage.create:', error);
      throw error;
    }
  }

  // Update static page
  static async update(id, pageData) {
    try {
      const { title, slug, content, is_published, show_in_footer, footer_section, external_link } = pageData;

      await executeQuery(`
        UPDATE static_pages SET
          title = ?,
          slug = ?,
          content = ?,
          is_published = ?,
          show_in_footer = ?,
          footer_section = ?,
          external_link = ?,
          updated_at = NOW()
        WHERE id = ?
      `, [
        title,
        slug,
        content,
        is_published ? 1 : 0,
        show_in_footer ? 1 : 0,
        footer_section || 'main',
        external_link || null,
        id
      ]);

      return { id, ...pageData };
    } catch (error) {
      console.error('Error in StaticPage.update:', error);
      throw error;
    }
  }

  // Delete static page
  static async delete(id) {
    try {
      await executeQuery(`
        DELETE FROM static_pages
        WHERE id = ?
      `, [id]);

      return { id };
    } catch (error) {
      console.error('Error in StaticPage.delete:', error);
      throw error;
    }
  }

  // Get pages for footer
  static async getFooterPages() {
    try {
      const rows = await executeQuery(`
        SELECT id, title, slug, footer_section, external_link
        FROM static_pages
        WHERE show_in_footer = 1 AND is_published = 1
        ORDER BY footer_section, title
      `);
      return rows;
    } catch (error) {
      console.error('Error in StaticPage.getFooterPages:', error);
      throw error;
    }
  }

  // Get all unique footer sections
  static async getFooterSections() {
    try {
      const rows = await executeQuery(`
        SELECT DISTINCT footer_section
        FROM static_pages
        WHERE show_in_footer = 1 AND is_published = 1
        ORDER BY footer_section
      `);
      return rows.map(row => row.footer_section);
    } catch (error) {
      console.error('Error in StaticPage.getFooterSections:', error);
      throw error;
    }
  }
}

module.exports = StaticPage;
