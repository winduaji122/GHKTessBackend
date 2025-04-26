const { executeQuery } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');
const slugify = require('slugify');

class Carousel {
  static async getAllSlides() {
    try {
      // Ambil semua slide aktif dan validasi post carousel yang terkait
      const slides = await executeQuery(
        `SELECT cs.*, p.title as post_title, p.slug as post_slug, cp.status as carousel_post_status
         FROM carousel_slides cs
         LEFT JOIN posts p ON cs.post_id = p.id AND p.status = 'published'
         LEFT JOIN carousel_posts cp ON cs.post_id = cp.id
         WHERE cs.active = 1
         ORDER BY cs.sort_order ASC`
      );

      // Filter slide yang terkait dengan post carousel yang statusnya published
      // atau slide yang terkait dengan post reguler (yang sudah difilter di query)
      // atau slide yang tidak terkait dengan post apapun
      return slides.filter(slide => {
        // Jika slide tidak terkait dengan post carousel, tampilkan
        if (!slide.carousel_post_status) return true;

        // Jika slide terkait dengan post carousel, hanya tampilkan jika statusnya published
        return slide.carousel_post_status === 'published';
      });
    } catch (error) {
      logger.error('Error getting carousel slides:', error);
      throw error;
    }
  }

  static async getAllSlidesAdmin() {
    try {
      return await executeQuery(
        `SELECT cs.*, p.title as post_title, p.slug as post_slug
         FROM carousel_slides cs
         LEFT JOIN posts p ON cs.post_id = p.id
         ORDER BY cs.sort_order ASC`
      );
    } catch (error) {
      logger.error('Error getting admin carousel slides:', error);
      throw error;
    }
  }

  static async getSlideById(id) {
    try {
      const rows = await executeQuery(
        `SELECT cs.*, p.title as post_title, p.slug as post_slug
         FROM carousel_slides cs
         LEFT JOIN posts p ON cs.post_id = p.id
         WHERE cs.id = ?`,
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
      const { title, description, image_url, link, button_text, active, sort_order, post_id, postType } = slideData;

      // Default values
      let finalTitle = title;
      let finalDescription = description;
      let finalImageUrl = image_url;
      let finalLink = link;
      let finalButtonText = button_text || 'Selengkapnya';

      // If post_id is provided, get post data and update slide data
      if (post_id) {
        if (postType === 'regular') {
          // Get regular post data
          const postRows = await executeQuery(
            `SELECT p.*, u.name as author_name
             FROM posts p
             LEFT JOIN users u ON p.author_id = u.id
             WHERE p.id = ?`,
            [post_id]
          );

          if (postRows.length > 0) {
            const post = postRows[0];
            finalTitle = post.title;
            finalDescription = post.excerpt || '';

            // Perbaikan penanganan URL gambar untuk regular post
            if (post.featured_image) {
              // Jika featured_image adalah URL lengkap, ekstrak path-nya
              if (post.featured_image.startsWith('http')) {
                // Ekstrak path dari URL lengkap
                const url = new URL(post.featured_image);
                const pathParts = url.pathname.split('/');
                // Ambil nama file dari path
                const fileName = pathParts[pathParts.length - 1];
                finalImageUrl = fileName;
                console.log('Extracted file name from featured_image URL:', fileName);
              } else if (post.featured_image.startsWith('uploads/')) {
                // Jika featured_image sudah memiliki prefix uploads/, gunakan langsung
                finalImageUrl = post.featured_image;
              } else {
                // Jika featured_image ada tapi tidak memiliki prefix uploads/, tambahkan
                finalImageUrl = `uploads/${post.featured_image}`;
              }
            } else if (post.image_url) {
              // Jika image_url adalah URL lengkap, ekstrak path-nya
              if (post.image_url.startsWith('http')) {
                // Ekstrak path dari URL lengkap
                const url = new URL(post.image_url);
                const pathParts = url.pathname.split('/');
                // Ambil nama file dari path
                const fileName = pathParts[pathParts.length - 1];
                finalImageUrl = fileName;
                console.log('Extracted file name from image_url URL:', fileName);
              } else if (post.image_url.startsWith('uploads/')) {
                // Jika image_url sudah memiliki prefix uploads/, gunakan langsung
                finalImageUrl = post.image_url;
              } else {
                // Jika image_url ada tapi tidak memiliki prefix uploads/, tambahkan
                finalImageUrl = `uploads/${post.image_url}`;
              }
            } else if (post.image) {
              // Jika image adalah URL lengkap, ekstrak path-nya
              if (post.image.startsWith('http')) {
                // Ekstrak path dari URL lengkap
                const url = new URL(post.image);
                const pathParts = url.pathname.split('/');
                // Ambil nama file dari path
                const fileName = pathParts[pathParts.length - 1];
                finalImageUrl = fileName;
                console.log('Extracted file name from image URL:', fileName);
              } else if (post.image.startsWith('uploads/')) {
                // Jika image sudah memiliki prefix uploads/, gunakan langsung
                finalImageUrl = post.image;
              } else {
                // Jika image ada tapi tidak memiliki prefix uploads/, tambahkan
                finalImageUrl = `uploads/${post.image}`;
              }
            } else {
              // Default fallback
              finalImageUrl = 'uploads/default-image.jpg';
            }

            finalLink = `/post/${post.slug}`;
            finalButtonText = 'Baca Selengkapnya';

            // Log untuk debugging
            console.log('Regular post image processing:', {
              post_id: post.id,
              featured_image: post.featured_image,
              image_url: post.image_url,
              image: post.image,
              final_image_url: finalImageUrl
            });
          }
        } else if (postType === 'carousel') {
          // Get carousel post data
          const postRows = await executeQuery(
            `SELECT * FROM carousel_posts WHERE id = ?`,
            [post_id]
          );

          if (postRows.length > 0) {
            const post = postRows[0];
            finalTitle = post.title;
            finalDescription = post.excerpt || '';
            finalImageUrl = post.image_url;
            finalLink = `/carousel-post/${post.slug}`;
            finalButtonText = post.button_text || 'Baca Artikel';

            // Update post status to published
            await executeQuery(
              `UPDATE carousel_posts SET status = 'published', updated_at = NOW() WHERE id = ?`,
              [post_id]
            );
          }
        }
      }

      // Cek apakah post_id sudah digunakan dalam slide lain
      if (post_id) {
        const existingSlides = await executeQuery(
          `SELECT * FROM carousel_slides WHERE post_id = ?`,
          [post_id]
        );

        // Jika post sudah digunakan dalam slide lain, tolak permintaan
        if (existingSlides.length > 0) {
          throw new Error('Post ini sudah digunakan dalam slide lain. Silakan pilih post yang berbeda.');
        }
      }

      // Pastikan image_url tidak null
      if (!finalImageUrl) {
        finalImageUrl = 'uploads/default-image.jpg';
      }

      // Tentukan image_source berdasarkan postType
      let imageSource = 'carousel'; // Default
      if (post_id && postType === 'regular') {
        imageSource = 'regular';
      }

      // Log data yang akan diinsert
      console.log('Creating slide with data:', {
        title: finalTitle,
        description: finalDescription,
        image_url: finalImageUrl,
        image_source: imageSource,
        link: finalLink,
        button_text: finalButtonText,
        post_id: post_id
      });

      const result = await executeQuery(
        `INSERT INTO carousel_slides
        (title, description, image_url, image_source, link, button_text, active, sort_order, post_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [finalTitle, finalDescription, finalImageUrl, imageSource, finalLink, finalButtonText, active || 1, sort_order || 0, post_id || null]
      );

      return {
        id: result.insertId,
        title: finalTitle,
        description: finalDescription,
        image_url: finalImageUrl,
        image_source: imageSource,
        link: finalLink,
        button_text: finalButtonText,
        active: active || 1,
        sort_order: sort_order || 0,
        post_id: post_id || null
      };
    } catch (error) {
      logger.error('Error creating carousel slide:', error);
      throw error;
    }
  }

  static async updateSlide(id, slideData) {
    try {
      const { title, description, image_url, link, button_text, active, sort_order, post_id } = slideData;

      await executeQuery(
        `UPDATE carousel_slides
        SET title = ?, description = ?, image_url = ?, link = ?,
        button_text = ?, active = ?, sort_order = ?, post_id = ?, updated_at = NOW()
        WHERE id = ?`,
        [title, description, image_url, link, button_text, active, sort_order, post_id, id]
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

  // Carousel Post Methods
  static async createCarouselPost(postData) {
    try {
      const { id, title, content, excerpt, image_url, side_image_url, button_text, active, publish_date, sort_order, status } = postData;

      // Generate slug from title
      const baseSlug = slugify(title, {
        lower: true,
        strict: true,
        remove: /[*+~.(),'"!:@]/g
      });

      // Check if slug exists and append random string if needed
      let slug = baseSlug;
      let slugExists = true;
      let attempts = 0;

      while (slugExists && attempts < 5) {
        const rows = await executeQuery(
          `SELECT COUNT(*) as count FROM carousel_posts WHERE slug = ?`,
          [slug]
        );

        if (rows[0].count === 0) {
          slugExists = false;
        } else {
          // Append random string to slug
          const randomString = Math.random().toString(36).substring(2, 8);
          slug = `${baseSlug}-${randomString}`;
          attempts++;
        }
      }

      const result = await executeQuery(
        `INSERT INTO carousel_posts
        (id, title, content, excerpt, image_url, side_image_url, button_text, active, status, publish_date, sort_order, slug, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [id, title, content, excerpt, image_url, side_image_url, button_text, active || 1, status || 'draft', publish_date, sort_order || 0, slug]
      );

      return { id, title, content, excerpt, image_url, side_image_url, button_text, active, status: status || 'draft', publish_date, sort_order, slug };
    } catch (error) {
      logger.error('Error creating carousel post:', error);
      throw error;
    }
  }

  static async getCarouselPostById(id) {
    try {
      logger.info(`Model: Getting carousel post with id ${id}`, { service: 'user-service' });

      // Coba cari berdasarkan ID numerik atau UUID
      let rows;

      // Jika ID adalah angka, coba cari berdasarkan ID numerik
      if (!isNaN(id) && String(id).length < 10) {
        logger.info(`Searching by numeric ID: ${id}`, { service: 'user-service' });
        rows = await executeQuery(
          `SELECT * FROM carousel_posts WHERE id = ? OR id = ?`,
          [id, String(id)]
        );
      } else {
        // Jika ID adalah UUID, cari berdasarkan UUID
        logger.info(`Searching by UUID: ${id}`, { service: 'user-service' });
        rows = await executeQuery(
          `SELECT * FROM carousel_posts WHERE id = ?`,
          [id]
        );
      }

      // Jika tidak ditemukan, coba cari berdasarkan kolom 'uuid' jika ada
      if (rows.length === 0) {
        logger.info(`Post not found by ID, checking if uuid column exists`, { service: 'user-service' });

        // Periksa apakah kolom 'uuid' ada
        const columnsResult = await executeQuery(
          `SHOW COLUMNS FROM carousel_posts LIKE 'uuid'`
        );

        if (columnsResult.length > 0) {
          logger.info(`uuid column exists, searching by uuid: ${id}`, { service: 'user-service' });
          rows = await executeQuery(
            `SELECT * FROM carousel_posts WHERE uuid = ?`,
            [id]
          );
        }
      }

      logger.info(`Model: Carousel post query result:`, {
        service: 'user-service',
        found: rows.length > 0,
        id,
        rowCount: rows.length
      });

      return rows[0];
    } catch (error) {
      logger.error(`Error getting carousel post with id ${id}:`, error);
      throw error;
    }
  }

  static async getCarouselPostBySlug(slug) {
    try {
      const rows = await executeQuery(
        `SELECT * FROM carousel_posts WHERE slug = ?`,
        [slug]
      );
      return rows[0];
    } catch (error) {
      logger.error(`Error getting carousel post with slug ${slug}:`, error);
      throw error;
    }
  }

  // Get regular post by slug to check if a carousel slide is linked to a regular post
  static async getRegularPostBySlug(slug) {
    try {
      logger.info(`Checking for regular post with slug ${slug}`, { service: 'user-service' });

      const rows = await executeQuery(
        `SELECT p.* FROM posts p WHERE p.slug = ? AND p.status = 'published'`,
        [slug]
      );

      logger.info(`Regular post query result:`, {
        service: 'user-service',
        found: rows.length > 0,
        slug,
        rowCount: rows.length
      });

      return rows[0];
    } catch (error) {
      logger.error(`Error checking for regular post with slug ${slug}:`, error);
      throw error;
    }
  }

  static async updateCarouselPost(id, postData) {
    try {
      const { title, content, excerpt, image_url, side_image_url, button_text, active, status, publish_date, sort_order } = postData;

      // Log data yang akan diupdate
      console.log('Updating carousel post with data:', {
        id,
        title,
        content: content ? 'Content present' : 'Content missing',
        excerpt: excerpt ? 'Excerpt present' : 'Excerpt missing',
        image_url,
        side_image_url,
        button_text,
        active,
        status,
        publish_date,
        sort_order
      });

      // Pastikan status dan image_url tidak null
      const finalStatus = status || 'draft';
      const finalImageUrl = image_url || 'uploads/default-image.jpg';
      const finalSideImageUrl = side_image_url || null; // Side image bisa null

      await executeQuery(
        `UPDATE carousel_posts
        SET title = ?, content = ?, excerpt = ?, image_url = ?, side_image_url = ?,
        button_text = ?, active = ?, status = ?, publish_date = ?, sort_order = ?, updated_at = NOW()
        WHERE id = ?`,
        [title, content, excerpt, finalImageUrl, finalSideImageUrl, button_text, active, finalStatus, publish_date, sort_order, id]
      );

      return { id, ...postData, status: finalStatus };
    } catch (error) {
      logger.error(`Error updating carousel post with id ${id}:`, error);
      throw error;
    }
  }

  static async deleteCarouselPost(id) {
    try {
      await executeQuery(
        `DELETE FROM carousel_posts WHERE id = ?`,
        [id]
      );
      return true;
    } catch (error) {
      logger.error(`Error deleting carousel post with id ${id}:`, error);
      throw error;
    }
  }

  static async getAllCarouselPosts(filters = {}) {
    try {
      let query = `SELECT * FROM carousel_posts`;
      const params = [];

      // Add WHERE clause if filters are provided
      if (Object.keys(filters).length > 0) {
        const conditions = [];

        if (filters.status) {
          conditions.push('status = ?');
          params.push(filters.status);
        }

        if (conditions.length > 0) {
          query += ` WHERE ${conditions.join(' AND ')}`;
        }
      }

      // Add ORDER BY clause
      query += ` ORDER BY sort_order ASC, publish_date DESC`;

      const rows = await executeQuery(query, params);
      return rows;
    } catch (error) {
      logger.error('Error getting carousel posts:', error);
      throw error;
    }
  }

  static async updateCarouselPostStatus(id, status) {
    try {
      await executeQuery(
        `UPDATE carousel_posts SET status = ?, updated_at = NOW() WHERE id = ?`,
        [status, id]
      );
      return true;
    } catch (error) {
      logger.error(`Error updating carousel post status with id ${id}:`, error);
      throw error;
    }
  }

  static async getSlidesByPostId(postId) {
    try {
      const rows = await executeQuery(
        `SELECT * FROM carousel_slides WHERE post_id = ?`,
        [postId]
      );
      return rows;
    } catch (error) {
      logger.error(`Error getting carousel slides with post_id ${postId}:`, error);
      throw error;
    }
  }

  static async updateSlideDescription(slideId, description) {
    try {
      await executeQuery(
        `UPDATE carousel_slides SET description = ?, updated_at = NOW() WHERE id = ?`,
        [description, slideId]
      );
      return true;
    } catch (error) {
      logger.error(`Error updating description for carousel slide with id ${slideId}:`, error);
      throw error;
    }
  }

  static async replaceSlideWithPost(slideId, postId, postType = 'carousel') {
    try {
      // Cek apakah post sudah digunakan dalam slide lain
      const existingSlides = await executeQuery(
        `SELECT * FROM carousel_slides WHERE post_id = ? AND id != ?`,
        [postId, slideId]
      );

      // Jika post sudah digunakan dalam slide lain, tolak permintaan
      if (existingSlides.length > 0) {
        throw new Error('Post ini sudah digunakan dalam slide lain. Silakan pilih post yang berbeda.');
      }

      let post;
      let link = '';

      if (postType === 'carousel') {
        // Get carousel post data
        const postRows = await executeQuery(
          `SELECT * FROM carousel_posts WHERE id = ?`,
          [postId]
        );

        if (postRows.length === 0) {
          throw new Error('Carousel post not found');
        }

        post = postRows[0];

        // Validasi: Hanya post carousel dengan status 'published' yang bisa dijadikan slide
        if (post.status !== 'published') {
          throw new Error('Hanya post carousel dengan status "published" yang dapat dijadikan slide');
        }

        link = `/carousel-post/${post.slug}`;
      } else {
        // Get regular post data
        const postRows = await executeQuery(
          `SELECT p.*, u.name as author_name
           FROM posts p
           LEFT JOIN users u ON p.author_id = u.id
           WHERE p.id = ?`,
          [postId]
        );

        if (postRows.length === 0) {
          throw new Error('Regular post not found');
        }

        post = postRows[0];
        link = `/post/${post.slug}`;
      }

      // Pastikan image_url tidak null dan diproses dengan benar
      let imageUrl;
      let imageSource;

      // Log untuk debugging
      console.log('Processing image for slide:', {
        post_id: post.id,
        post_type: postType,
        featured_image: post.featured_image,
        image_url: post.image_url,
        image: post.image,
        title: post.title,
        slug: post.slug
      });

      if (postType === 'carousel') {
        // Untuk carousel post, gunakan image_url langsung
        imageUrl = post.image_url || 'uploads/default-image.jpg';
        imageSource = 'carousel';
        console.log('Using carousel post image:', imageUrl);
      } else {
        // Untuk regular post, periksa berbagai kemungkinan field gambar
        // Gunakan path gambar asli tanpa modifikasi untuk regular post
        // Ini akan memastikan URL gambar konsisten dengan yang digunakan di AdminPosts.jsx
        imageSource = 'regular';

        // Cek apakah post memiliki image atau featured_image
        if (post.image) {
          // Jika image adalah URL lengkap, ekstrak path-nya
          if (post.image.startsWith('http')) {
            // Ekstrak path dari URL lengkap
            const url = new URL(post.image);
            const pathParts = url.pathname.split('/');
            // Ambil nama file dari path
            const fileName = pathParts[pathParts.length - 1];
            imageUrl = fileName;
            console.log('Extracted file name from image URL:', fileName);
          } else {
            // Gunakan image apa adanya
            imageUrl = post.image;
            console.log('Using post.image directly:', imageUrl);
          }
        } else if (post.featured_image) {
          // Jika featured_image adalah URL lengkap, ekstrak path-nya
          if (post.featured_image.startsWith('http')) {
            // Ekstrak path dari URL lengkap
            const url = new URL(post.featured_image);
            const pathParts = url.pathname.split('/');
            // Ambil nama file dari path
            const fileName = pathParts[pathParts.length - 1];
            imageUrl = fileName;
            console.log('Extracted file name from featured_image URL:', fileName);
          } else {
            // Gunakan featured_image apa adanya
            imageUrl = post.featured_image;
            console.log('Using post.featured_image directly:', imageUrl);
          }
        } else if (post.image_url) {
          // Jika image_url adalah URL lengkap, ekstrak path-nya
          if (post.image_url.startsWith('http')) {
            // Ekstrak path dari URL lengkap
            const url = new URL(post.image_url);
            const pathParts = url.pathname.split('/');
            // Ambil nama file dari path
            const fileName = pathParts[pathParts.length - 1];
            imageUrl = fileName;
            console.log('Extracted file name from image_url URL:', fileName);
          } else {
            // Gunakan image_url apa adanya
            imageUrl = post.image_url;
            console.log('Using post.image_url directly:', imageUrl);
          }
        } else {
          // Default fallback
          imageUrl = 'uploads/default-image.jpg';
          imageSource = 'default';
          console.log('No image found, using default:', imageUrl);
        }
      }

      // Log data yang akan diupdate
      console.log('Updating slide with data:', {
        title: post.title,
        description: post.excerpt || '',
        image_url: imageUrl,
        image_source: imageSource,
        post_id: post.id,
        link: link
      });

      // Update slide with post data
      await executeQuery(
        `UPDATE carousel_slides
        SET title = ?, description = ?, image_url = ?, image_source = ?, button_text = ?, post_id = ?, link = ?, updated_at = NOW()
        WHERE id = ?`,
        [post.title, post.excerpt || '', imageUrl, imageSource, 'Baca Selengkapnya', post.id, link, slideId]
      );

      return true;
    } catch (error) {
      logger.error(`Error replacing slide with post:`, error);
      throw error;
    }
  }
}

module.exports = Carousel;
