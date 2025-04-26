const Carousel = require('../models/Carousel');
const { logger } = require('../utils/logger');
const { uploadImage } = require('../utils/fileUpload');
const path = require('path');
const fs = require('fs');
const { FALLBACK_CAROUSEL } = require('../data/fallbackData');

// Get all active carousel slides
exports.getAllSlides = async (req, res) => {
  try {
    try {
      const slides = await Carousel.getAllSlides();
      res.json({ success: true, slides });
    } catch (dbError) {
      logger.error('Database error in getAllSlides controller:', {
        error: dbError.message,
        stack: dbError.stack,
        service: 'carousel-service'
      });

      // Gunakan fallback data jika terjadi error database
      logger.warn('Using fallback data for carousel slides', { service: 'carousel-service' });
      return res.json(FALLBACK_CAROUSEL);
    }
  } catch (error) {
    logger.error('Error in getAllSlides controller:', {
      error: error.message,
      stack: error.stack,
      service: 'carousel-service'
    });

    // Gunakan fallback data jika terjadi error
    return res.json(FALLBACK_CAROUSEL);
  }
};

// Get all slides for admin (including inactive)
exports.getAllSlidesAdmin = async (req, res) => {
  try {
    // Untuk admin, kita ambil semua slide termasuk yang tidak aktif
    const slides = await Carousel.getAllSlidesAdmin();
    res.json({ success: true, slides });
  } catch (error) {
    logger.error('Error in getAllSlidesAdmin controller:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data carousel' });
  }
};

// Get slide by ID
exports.getSlideById = async (req, res) => {
  try {
    const { id } = req.params;
    const slide = await Carousel.getSlideById(id);

    if (!slide) {
      return res.status(404).json({ success: false, message: 'Slide tidak ditemukan' });
    }

    res.json({ success: true, slide });
  } catch (error) {
    logger.error(`Error in getSlideById controller for id ${req.params.id}:`, error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data slide' });
  }
};

// Create new slide
exports.createSlide = async (req, res) => {
  try {
    let slideData = {
      title: req.body.title,
      description: req.body.description,
      link: req.body.link || null,
      button_text: req.body.button_text || 'Selengkapnya',
      active: req.body.active === undefined ? 1 : req.body.active,
      sort_order: req.body.sort_order || 0,
      post_id: req.body.postId || req.body.post_id || null,
      postType: req.body.postType || 'carousel'
    };

    // Handle image upload
    if (req.file) {
      const uploadDir = path.join(__dirname, '../uploads/carousel');

      // Ensure directory exists
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filename = `carousel-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(req.file.originalname)}`;
      const filePath = path.join(uploadDir, filename);

      // Write file
      fs.writeFileSync(filePath, req.file.buffer);

      // Set image URL
      slideData.image_url = `uploads/carousel/${filename}`;
    } else if (req.body.image_url) {
      // If image is provided as URL
      slideData.image_url = req.body.image_url;
    } else if (slideData.post_id) {
      // If post_id is provided, we'll get the image from the post
      // No need to return error here as the image will be fetched from the post
    } else {
      return res.status(400).json({ success: false, message: 'Gambar slide diperlukan' });
    }

    const newSlide = await Carousel.createSlide(slideData);
    res.status(201).json({ success: true, slide: newSlide, message: 'Slide berhasil dibuat' });
  } catch (error) {
    logger.error('Error in createSlide controller:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat membuat slide baru' });
  }
};

// Update slide
exports.updateSlide = async (req, res) => {
  try {
    const { id } = req.params;
    const existingSlide = await Carousel.getSlideById(id);

    if (!existingSlide) {
      return res.status(404).json({ success: false, message: 'Slide tidak ditemukan' });
    }

    let slideData = {
      title: req.body.title || existingSlide.title,
      description: req.body.description || existingSlide.description,
      image_url: existingSlide.image_url,
      link: req.body.link !== undefined ? req.body.link : existingSlide.link,
      button_text: req.body.button_text || existingSlide.button_text,
      active: req.body.active !== undefined ? req.body.active : existingSlide.active,
      sort_order: req.body.sort_order !== undefined ? req.body.sort_order : existingSlide.sort_order,
      post_id: req.body.post_id !== undefined ? req.body.post_id : existingSlide.post_id
    };

    // Handle image upload
    if (req.file) {
      const uploadDir = path.join(__dirname, '../uploads/carousel');

      // Ensure directory exists
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filename = `carousel-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(req.file.originalname)}`;
      const filePath = path.join(uploadDir, filename);

      // Write file
      fs.writeFileSync(filePath, req.file.buffer);

      // Delete old image if it exists and is not a URL
      if (existingSlide.image_url && existingSlide.image_url.startsWith('uploads/carousel/')) {
        const oldImagePath = path.join(__dirname, '..', existingSlide.image_url);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }

      // Set new image URL
      slideData.image_url = `uploads/carousel/${filename}`;
    } else if (req.body.image_url) {
      // If image is provided as URL
      slideData.image_url = req.body.image_url;
    }

    const updatedSlide = await Carousel.updateSlide(id, slideData);
    res.json({ success: true, slide: updatedSlide, message: 'Slide berhasil diperbarui' });
  } catch (error) {
    logger.error(`Error in updateSlide controller for id ${req.params.id}:`, error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat memperbarui slide' });
  }
};

// Delete slide
exports.deleteSlide = async (req, res) => {
  try {
    const { id } = req.params;
    const existingSlide = await Carousel.getSlideById(id);

    if (!existingSlide) {
      return res.status(404).json({ success: false, message: 'Slide tidak ditemukan' });
    }

    // Delete image file if it exists and is not a URL
    if (existingSlide.image_url && existingSlide.image_url.startsWith('uploads/carousel/')) {
      const imagePath = path.join(__dirname, '..', existingSlide.image_url);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    await Carousel.deleteSlide(id);
    res.json({ success: true, message: 'Slide berhasil dihapus' });
  } catch (error) {
    logger.error(`Error in deleteSlide controller for id ${req.params.id}:`, error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat menghapus slide' });
  }
};

// Update slides order
exports.updateSlidesOrder = async (req, res) => {
  try {
    const { slides } = req.body;

    if (!slides || !Array.isArray(slides)) {
      return res.status(400).json({ success: false, message: 'Data urutan slide tidak valid' });
    }

    await Carousel.updateSlidesOrder(slides);
    res.json({ success: true, message: 'Urutan slide berhasil diperbarui' });
  } catch (error) {
    logger.error('Error in updateSlidesOrder controller:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat memperbarui urutan slide' });
  }
};

// Replace slide with post (carousel or regular)
exports.replaceSlideWithPost = async (req, res) => {
  try {
    const { slideId } = req.params;
    const { postId, postType = 'carousel' } = req.body;

    if (!slideId || !postId) {
      return res.status(400).json({ success: false, message: 'ID slide dan ID post diperlukan' });
    }

    // Check if slide exists
    const slide = await Carousel.getSlideById(slideId);
    if (!slide) {
      return res.status(404).json({ success: false, message: 'Slide tidak ditemukan' });
    }

    try {
      await Carousel.replaceSlideWithPost(slideId, postId, postType);

      const message = postType === 'carousel'
        ? 'Slide berhasil diganti dengan post carousel'
        : 'Slide berhasil diganti dengan post reguler';

      res.json({ success: true, message });
    } catch (validationError) {
      // Tangkap error validasi dari model
      logger.warn('Validation error in replaceSlideWithPost:', validationError.message);
      return res.status(400).json({
        success: false,
        message: validationError.message || 'Post tidak memenuhi syarat untuk dijadikan slide'
      });
    }
  } catch (error) {
    logger.error('Error in replaceSlideWithPost controller:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengganti slide dengan post' });
  }
};
