const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const Carousel = require('../models/Carousel');
const { logger } = require('../utils/logger');
const { uploadImage, deleteImage } = require('../utils/fileUpload');

// Create new carousel post
exports.createCarouselPost = async (req, res) => {
  try {
    let postData = {
      title: req.body.title,
      content: req.body.content,
      excerpt: req.body.excerpt || '',
      button_text: req.body.button_text || 'Baca Artikel',
      active: req.body.active === undefined ? 1 : req.body.active,
      publish_date: req.body.publish_date || new Date(),
      sort_order: req.body.sort_order || 0
    };

    // Handle main image upload
    if (req.files && req.files.image) {
      const mainImageResult = await uploadImage(req.files.image[0], 'carousel');
      postData.image_url = mainImageResult;
    } else if (req.body.image_url) {
      postData.image_url = req.body.image_url;
    } else {
      return res.status(400).json({ success: false, message: 'Gambar utama harus diisi' });
    }


    // Handle side image upload (optional)
    if (req.files && req.files.side_image) {
      const sideImageResult = await uploadImage(req.files.side_image[0], 'carousel');
      postData.side_image_url = sideImageResult;
    } else if (req.body.side_image_url) {
      postData.side_image_url = req.body.side_image_url;
    }

    // Generate unique ID for the post
    postData.id = uuidv4();

    // Create carousel post
    const result = await Carousel.createCarouselPost(postData);

    return res.status(201).json({
      success: true,
      message: 'Carousel post berhasil dibuat',
      post: result
    });
  } catch (err) {
    logger.error('Error creating carousel post:', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat membuat carousel post' });
  }
};

// Get carousel post by ID
exports.getCarouselPostById = async (req, res) => {
  try {
    const { id } = req.params;
    logger.info(`Getting carousel post with id ${id}`, { service: 'user-service' });

    const post = await Carousel.getCarouselPostById(id);
    logger.info(`Carousel post query result:`, { service: 'user-service', found: !!post, id });

    if (!post) {
      logger.warn(`Carousel post not found with id ${id}`, { service: 'user-service' });
      return res.status(404).json({ success: false, message: 'Carousel post tidak ditemukan' });
    }

    return res.json({
      success: true,
      post
    });
  } catch (err) {
    logger.error(`Error getting carousel post with id ${req.params.id}:`, err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data carousel post' });
  }
};

// Get carousel post by slug
exports.getCarouselPostBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const post = await Carousel.getCarouselPostBySlug(slug);

    if (!post) {
      return res.status(404).json({ success: false, message: 'Carousel post tidak ditemukan' });
    }

    return res.json({
      success: true,
      post
    });
  } catch (err) {
    logger.error(`Error getting carousel post with slug ${req.params.slug}:`, err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data carousel post' });
  }
};

// Update carousel post
exports.updateCarouselPost = async (req, res) => {
  try {
    const { id } = req.params;
    const existingPost = await Carousel.getCarouselPostById(id);

    if (!existingPost) {
      return res.status(404).json({ success: false, message: 'Carousel post tidak ditemukan' });
    }

    let postData = {
      title: req.body.title || existingPost.title,
      content: req.body.content || existingPost.content,
      excerpt: req.body.excerpt || existingPost.excerpt,
      button_text: req.body.button_text || existingPost.button_text,
      active: req.body.active !== undefined ? req.body.active : existingPost.active,
      publish_date: req.body.publish_date || existingPost.publish_date,
      sort_order: req.body.sort_order !== undefined ? req.body.sort_order : existingPost.sort_order,
      image_url: existingPost.image_url,
      side_image_url: existingPost.side_image_url
    };

    // Handle main image upload
    if (req.files && req.files.image) {
      const mainImageResult = await uploadImage(req.files.image[0], 'carousel');
      // Delete old image if exists
      if (existingPost.image_url) {
        await deleteImage(existingPost.image_url);
      }
      postData.image_url = mainImageResult;
    }

    // Handle side image upload
    if (req.files && req.files.side_image) {
      const sideImageResult = await uploadImage(req.files.side_image[0], 'carousel');
      // Delete old side image if exists
      if (existingPost.side_image_url) {
        await deleteImage(existingPost.side_image_url);
      }
      postData.side_image_url = sideImageResult;
    }

    // Update carousel post
    const result = await Carousel.updateCarouselPost(id, postData);

    // Cek apakah ada slide carousel yang terkait dengan post ini
    // dan perbarui description slide dengan excerpt baru
    try {
      const slides = await Carousel.getSlidesByPostId(id);
      if (slides && slides.length > 0) {
        console.log(`Found ${slides.length} carousel slides linked to post ${id}, updating descriptions`);

        for (const slide of slides) {
          // Update slide description dengan excerpt baru
          await Carousel.updateSlideDescription(slide.id, postData.excerpt || '');
          console.log(`Updated description for slide ${slide.id}`);
        }
      }
    } catch (slideError) {
      logger.error(`Error updating linked carousel slides for post ${id}:`, slideError);
      // Tidak mengembalikan error ke client karena update post sudah berhasil
    }

    return res.json({
      success: true,
      message: 'Carousel post berhasil diperbarui',
      post: result
    });
  } catch (err) {
    logger.error(`Error updating carousel post with id ${req.params.id}:`, err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat memperbarui carousel post' });
  }
};

// Delete carousel post
exports.deleteCarouselPost = async (req, res) => {
  try {
    const { id } = req.params;
    const existingPost = await Carousel.getCarouselPostById(id);

    if (!existingPost) {
      return res.status(404).json({ success: false, message: 'Carousel post tidak ditemukan' });
    }

    // Delete images if exist
    if (existingPost.image_url) {
      await deleteImage(existingPost.image_url);
    }

    if (existingPost.side_image_url) {
      await deleteImage(existingPost.side_image_url);
    }

    // Delete carousel post
    await Carousel.deleteCarouselPost(id);

    return res.json({
      success: true,
      message: 'Carousel post berhasil dihapus'
    });
  } catch (err) {
    logger.error(`Error deleting carousel post with id ${req.params.id}:`, err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat menghapus carousel post' });
  }
};

// Get all carousel posts
exports.getAllCarouselPosts = async (req, res) => {
  try {
    // Get filter from query params
    const filters = {};
    if (req.query.status) {
      filters.status = req.query.status;
    }

    const posts = await Carousel.getAllCarouselPosts(filters);

    return res.json({
      success: true,
      posts
    });
  } catch (err) {
    logger.error('Error getting all carousel posts:', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data carousel posts' });
  }
};

// Get public carousel post by slug
exports.getPublicCarouselPostBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    logger.info(`Getting public carousel post with slug ${slug}`, { service: 'user-service' });

    const post = await Carousel.getCarouselPostBySlug(slug);

    if (!post) {
      logger.warn(`Carousel post not found with slug ${slug}, checking regular posts`, { service: 'user-service' });

      // Cek apakah ini adalah post reguler yang ditampilkan di carousel
      const regularPost = await Carousel.getRegularPostBySlug(slug);

      if (regularPost) {
        // Jika ditemukan post reguler, kirim respons dengan informasi redirect
        logger.info(`Found regular post with slug ${slug}, sending redirect info`, { service: 'user-service' });
        return res.json({
          success: true,
          redirect: true,
          redirectUrl: `/post/${slug}`,
          message: 'Post ini adalah post reguler, bukan carousel post'
        });
      }

      return res.status(404).json({ success: false, message: 'Carousel post tidak ditemukan' });
    }

    // Ensure post is published
    if (post.status !== 'published') {
      logger.warn(`Carousel post with slug ${slug} is not published`, { service: 'user-service' });
      return res.status(404).json({ success: false, message: 'Carousel post tidak ditemukan' });
    }

    // Format image URLs to include base URL if needed
    if (post.image_url && !post.image_url.startsWith('http')) {
      post.image_url = `carousel/${post.image_url}`;
    }

    if (post.side_image_url && !post.side_image_url.startsWith('http')) {
      post.side_image_url = `carousel/${post.side_image_url}`;
    }

    logger.info(`Successfully retrieved carousel post with slug ${slug}`, { service: 'user-service' });
    return res.json({
      success: true,
      post
    });
  } catch (err) {
    logger.error(`Error getting public carousel post with slug ${req.params.slug}:`, err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data carousel post' });
  }
};

// Update carousel post status
exports.updateCarouselPostStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['draft', 'published'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status tidak valid. Gunakan "draft" atau "published"' });
    }

    const existingPost = await Carousel.getCarouselPostById(id);

    if (!existingPost) {
      return res.status(404).json({ success: false, message: 'Carousel post tidak ditemukan' });
    }

    await Carousel.updateCarouselPostStatus(id, status);

    return res.json({
      success: true,
      message: `Status carousel post berhasil diubah menjadi ${status === 'draft' ? 'draft' : 'published'}`
    });
  } catch (err) {
    logger.error(`Error updating carousel post status with id ${req.params.id}:`, err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengubah status carousel post' });
  }
};
