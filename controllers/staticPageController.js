const StaticPage = require('../models/StaticPage');

// Get all static pages
exports.getAllPages = async (req, res) => {
  try {
    const pages = await StaticPage.getAll();
    res.json({
      success: true,
      data: pages
    });
  } catch (error) {
    console.error('Error in getAllPages controller:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil halaman statis',
      error: error.message
    });
  }
};

// Get static page by ID
exports.getPageById = async (req, res) => {
  try {
    const { id } = req.params;
    const page = await StaticPage.getById(id);

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Halaman tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: page
    });
  } catch (error) {
    console.error('Error in getPageById controller:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil halaman',
      error: error.message
    });
  }
};

// Get static page by slug
exports.getPageBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const page = await StaticPage.getBySlug(slug);

    if (!page) {
      return res.status(404).json({
        success: false,
        message: 'Halaman tidak ditemukan'
      });
    }

    // If page is not published and user is not admin, return 404
    if (!page.is_published && (!req.user || req.user.role !== 'admin')) {
      return res.status(404).json({
        success: false,
        message: 'Halaman tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: page
    });
  } catch (error) {
    console.error('Error in getPageBySlug controller:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil halaman',
      error: error.message
    });
  }
};

// Create new static page
exports.createPage = async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki izin untuk membuat halaman'
      });
    }

    const { title, slug, content, is_published, show_in_footer, footer_section, external_link } = req.body;

    // Validate required fields
    if (!title || !slug || !content) {
      return res.status(400).json({
        success: false,
        message: 'Judul, slug, dan konten harus diisi'
      });
    }

    // Check if slug already exists
    const existingPage = await StaticPage.getBySlug(slug);
    if (existingPage) {
      return res.status(400).json({
        success: false,
        message: 'Slug sudah digunakan, silakan gunakan slug lain'
      });
    }

    const newPage = await StaticPage.create({
      title,
      slug,
      content,
      is_published: is_published !== undefined ? is_published : true,
      show_in_footer: show_in_footer !== undefined ? show_in_footer : true,
      footer_section: footer_section || 'main',
      external_link
    });

    res.status(201).json({
      success: true,
      message: 'Halaman berhasil dibuat',
      data: newPage
    });
  } catch (error) {
    console.error('Error in createPage controller:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat membuat halaman',
      error: error.message
    });
  }
};

// Update static page
exports.updatePage = async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki izin untuk memperbarui halaman'
      });
    }

    const { id } = req.params;
    const { title, slug, content, is_published, show_in_footer, footer_section, external_link } = req.body;

    // Validate required fields
    if (!title || !slug || !content) {
      return res.status(400).json({
        success: false,
        message: 'Judul, slug, dan konten harus diisi'
      });
    }

    // Check if page exists
    const existingPage = await StaticPage.getById(id);
    if (!existingPage) {
      return res.status(404).json({
        success: false,
        message: 'Halaman tidak ditemukan'
      });
    }

    // Check if slug already exists (except for this page)
    if (slug !== existingPage.slug) {
      const pageWithSlug = await StaticPage.getBySlug(slug);
      if (pageWithSlug) {
        return res.status(400).json({
          success: false,
          message: 'Slug sudah digunakan, silakan gunakan slug lain'
        });
      }
    }

    const updatedPage = await StaticPage.update(id, {
      title,
      slug,
      content,
      is_published: is_published !== undefined ? is_published : true,
      show_in_footer: show_in_footer !== undefined ? show_in_footer : true,
      footer_section: footer_section || 'main',
      external_link
    });

    res.json({
      success: true,
      message: 'Halaman berhasil diperbarui',
      data: updatedPage
    });
  } catch (error) {
    console.error('Error in updatePage controller:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui halaman',
      error: error.message
    });
  }
};

// Delete static page
exports.deletePage = async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki izin untuk menghapus halaman'
      });
    }

    const { id } = req.params;

    // Check if page exists
    const existingPage = await StaticPage.getById(id);
    if (!existingPage) {
      return res.status(404).json({
        success: false,
        message: 'Halaman tidak ditemukan'
      });
    }

    await StaticPage.delete(id);

    res.json({
      success: true,
      message: 'Halaman berhasil dihapus',
      data: { id }
    });
  } catch (error) {
    console.error('Error in deletePage controller:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus halaman',
      error: error.message
    });
  }
};

// Get pages for footer
exports.getFooterPages = async (req, res) => {
  try {
    const pages = await StaticPage.getFooterPages();

    // Group pages by footer section
    const groupedPages = pages.reduce((acc, page) => {
      const section = page.footer_section || 'main';
      if (!acc[section]) {
        acc[section] = [];
      }
      acc[section].push(page);
      return acc;
    }, {});

    res.json({
      success: true,
      data: groupedPages
    });
  } catch (error) {
    console.error('Error in getFooterPages controller:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil halaman footer',
      error: error.message
    });
  }
};

// Get all unique footer sections
exports.getFooterSections = async (req, res) => {
  try {
    const sections = await StaticPage.getFooterSections();

    // Pastikan bagian default selalu ada
    const defaultSections = ['main', 'links', 'social'];
    const allSections = [...new Set([...defaultSections, ...sections])];

    res.json({
      success: true,
      data: allSections
    });
  } catch (error) {
    console.error('Error in getFooterSections controller:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil bagian footer',
      error: error.message
    });
  }
};
