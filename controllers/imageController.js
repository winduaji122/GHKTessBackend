const ImageService = require('../services/imageService');
const Image = require('../models/Image');
const { logger } = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;

/**
 * Controller untuk menangani upload gambar
 */
const imageController = {
  /**
   * Upload dan proses gambar
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async uploadImage(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      const { userId, postId } = req.body;

      // Proses gambar dengan Sharp
      const processedImage = await ImageService.processImage(req.file, {
        userId: userId || req.user?.id,
        postId,
        storageType: 'local' // Bisa diganti dengan 's3' jika menggunakan S3
      });

      // Buat URL lengkap
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const imageUrls = {
        original: `${baseUrl}${processedImage.originalUrl}`,
        medium: `${baseUrl}${processedImage.mediumUrl}`,
        thumbnail: `${baseUrl}${processedImage.thumbnailUrl}`
      };

      return res.status(200).json({
        success: true,
        message: 'Image uploaded and processed successfully',
        data: {
          id: processedImage.id,
          urls: imageUrls,
          width: processedImage.width,
          height: processedImage.height,
          size: processedImage.size,
          format: processedImage.format
        }
      });
    } catch (error) {
      logger.error('Error in uploadImage controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Error processing image',
        error: error.message
      });
    }
  },

  /**
   * Mendapatkan metadata gambar berdasarkan ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getImageById(req, res) {
    try {
      const { id } = req.params;

      const image = await Image.findById(id);

      if (!image) {
        return res.status(404).json({
          success: false,
          message: 'Image not found'
        });
      }

      // Buat URL lengkap
      const baseUrl = `${req.protocol}://${req.get('host')}`;

      return res.status(200).json({
        success: true,
        data: {
          id: image.id,
          urls: {
            original: `${baseUrl}/${image.original_path}`,
            medium: `${baseUrl}/${image.medium_path}`,
            thumbnail: `${baseUrl}/${image.thumbnail_path}`
          },
          width: image.width,
          height: image.height,
          size: image.size,
          mimeType: image.mime_type,
          createdAt: image.created_at
        }
      });
    } catch (error) {
      logger.error('Error in getImageById controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Error retrieving image',
        error: error.message
      });
    }
  },

  /**
   * Menghapus gambar berdasarkan ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteImage(req, res) {
    try {
      const { id } = req.params;

      const success = await ImageService.deleteImage(id);

      if (!success) {
        return res.status(404).json({
          success: false,
          message: 'Image not found or could not be deleted'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Image deleted successfully'
      });
    } catch (error) {
      logger.error('Error in deleteImage controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Error deleting image',
        error: error.message
      });
    }
  },

  /**
   * Mendapatkan semua gambar untuk post tertentu
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getImagesByPostId(req, res) {
    try {
      const { postId } = req.params;

      const images = await Image.findByPostId(postId);

      // Buat URL lengkap
      const baseUrl = `${req.protocol}://${req.get('host')}`;

      const formattedImages = images.map(image => ({
        id: image.id,
        urls: {
          original: `${baseUrl}/${image.original_path}`,
          medium: `${baseUrl}/${image.medium_path}`,
          thumbnail: `${baseUrl}/${image.thumbnail_path}`
        },
        width: image.width,
        height: image.height,
        size: image.size,
        createdAt: image.created_at
      }));

      return res.status(200).json({
        success: true,
        data: formattedImages
      });
    } catch (error) {
      logger.error('Error in getImagesByPostId controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Error retrieving images',
        error: error.message
      });
    }
  },

  /**
   * Mendapatkan gambar asli berdasarkan ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getOriginalImage(req, res) {
    try {
      const { id } = req.params;

      const image = await Image.findById(id);

      if (!image) {
        logger.error(`Image not found with ID: ${id}`);
        return res.status(404).json({
          success: false,
          message: 'Image not found'
        });
      }

      // Log untuk debugging
      logger.info(`Serving original image: ${id}`, {
        path: image.original_path,
        mimeType: image.mime_type
      });

      // Set cache headers
      res.set({
        'Cache-Control': 'public, max-age=31536000',
        'Expires': new Date(Date.now() + 31536000000).toUTCString(),
        'Cross-Origin-Resource-Policy': 'cross-origin'
      });

      // Dapatkan path lengkap ke file
      const fs = require('fs');
      const path = require('path');

      // Coba beberapa kemungkinan path
      const possiblePaths = [
        // Path yang disimpan di database
        path.join(__dirname, '..', image.original_path),
        // Path relatif terhadap root
        path.join(__dirname, '..', 'uploads', 'original', `${id}${path.extname(image.original_path)}`),
        // Path absolut
        path.resolve(image.original_path)
      ];

      let fileFound = false;
      let foundPath = '';

      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          fileFound = true;
          foundPath = filePath;
          logger.info(`Found image at: ${filePath}`);
          break;
        } else {
          logger.warn(`File not found at: ${filePath}`);
        }
      }

      if (!fileFound) {
        // Coba cari file berdasarkan ID di direktori uploads/original
        const uploadsDir = path.join(__dirname, '..', 'uploads', 'original');
        const files = fs.readdirSync(uploadsDir);

        for (const file of files) {
          if (file.startsWith(id)) {
            fileFound = true;
            foundPath = path.join(uploadsDir, file);
            logger.info(`Found image by ID search: ${foundPath}`);
            break;
          }
        }
      }

      if (!fileFound) {
        logger.error(`File not found for image ID: ${id}`);
        return res.status(404).json({
          success: false,
          message: 'Image file not found',
          paths: possiblePaths
        });
      }

      // Kirim file langsung
      return res.sendFile(foundPath);
    } catch (error) {
      logger.error('Error in getOriginalImage controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Error retrieving original image',
        error: error.message
      });
    }
  },

  /**
   * Mendapatkan gambar ukuran sedang berdasarkan ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getMediumImage(req, res) {
    try {
      const { id } = req.params;

      const image = await Image.findById(id);

      if (!image) {
        logger.error(`Image not found with ID: ${id}`);
        return res.status(404).json({
          success: false,
          message: 'Image not found'
        });
      }

      // Log untuk debugging
      logger.info(`Serving medium image: ${id}`, {
        path: image.medium_path,
        mimeType: image.mime_type
      });

      // Set cache headers
      res.set({
        'Cache-Control': 'public, max-age=31536000',
        'Expires': new Date(Date.now() + 31536000000).toUTCString(),
        'Cross-Origin-Resource-Policy': 'cross-origin'
      });

      // Dapatkan path lengkap ke file
      const fs = require('fs');
      const path = require('path');

      // Coba beberapa kemungkinan path
      const possiblePaths = [
        // Path yang disimpan di database
        path.join(__dirname, '..', image.medium_path),
        // Path relatif terhadap root
        path.join(__dirname, '..', 'uploads', 'medium', `${id}${path.extname(image.medium_path)}`),
        // Path absolut
        path.resolve(image.medium_path)
      ];

      let fileFound = false;
      let foundPath = '';

      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          fileFound = true;
          foundPath = filePath;
          logger.info(`Found image at: ${filePath}`);
          break;
        } else {
          logger.warn(`File not found at: ${filePath}`);
        }
      }

      if (!fileFound) {
        // Coba cari file berdasarkan ID di direktori uploads/medium
        const uploadsDir = path.join(__dirname, '..', 'uploads', 'medium');
        const files = fs.readdirSync(uploadsDir);

        for (const file of files) {
          if (file.startsWith(id)) {
            fileFound = true;
            foundPath = path.join(uploadsDir, file);
            logger.info(`Found image by ID search: ${foundPath}`);
            break;
          }
        }
      }

      if (!fileFound) {
        logger.error(`File not found for image ID: ${id}`);
        return res.status(404).json({
          success: false,
          message: 'Image file not found',
          paths: possiblePaths
        });
      }

      // Kirim file langsung
      return res.sendFile(foundPath);
    } catch (error) {
      logger.error('Error in getMediumImage controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Error retrieving medium image',
        error: error.message
      });
    }
  },

  /**
   * Mendapatkan gambar thumbnail berdasarkan ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getThumbnailImage(req, res) {
    try {
      const { id } = req.params;

      const image = await Image.findById(id);

      if (!image) {
        logger.error(`Image not found with ID: ${id}`);
        return res.status(404).json({
          success: false,
          message: 'Image not found'
        });
      }

      // Log untuk debugging
      logger.info(`Serving thumbnail image: ${id}`, {
        path: image.thumbnail_path,
        mimeType: image.mime_type
      });

      // Set cache headers
      res.set({
        'Cache-Control': 'public, max-age=31536000',
        'Expires': new Date(Date.now() + 31536000000).toUTCString(),
        'Cross-Origin-Resource-Policy': 'cross-origin'
      });

      // Dapatkan path lengkap ke file
      const fs = require('fs');
      const path = require('path');

      // Coba beberapa kemungkinan path
      const possiblePaths = [
        // Path yang disimpan di database
        path.join(__dirname, '..', image.thumbnail_path),
        // Path relatif terhadap root
        path.join(__dirname, '..', 'uploads', 'thumbnail', `${id}${path.extname(image.thumbnail_path)}`),
        // Path absolut
        path.resolve(image.thumbnail_path)
      ];

      let fileFound = false;
      let foundPath = '';

      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          fileFound = true;
          foundPath = filePath;
          logger.info(`Found image at: ${filePath}`);
          break;
        } else {
          logger.warn(`File not found at: ${filePath}`);
        }
      }

      if (!fileFound) {
        // Coba cari file berdasarkan ID di direktori uploads/thumbnail
        const uploadsDir = path.join(__dirname, '..', 'uploads', 'thumbnail');
        const files = fs.readdirSync(uploadsDir);

        for (const file of files) {
          if (file.startsWith(id)) {
            fileFound = true;
            foundPath = path.join(uploadsDir, file);
            logger.info(`Found image by ID search: ${foundPath}`);
            break;
          }
        }
      }

      if (!fileFound) {
        logger.error(`File not found for image ID: ${id}`);
        return res.status(404).json({
          success: false,
          message: 'Image file not found',
          paths: possiblePaths
        });
      }

      // Kirim file langsung
      return res.sendFile(foundPath);
    } catch (error) {
      logger.error('Error in getThumbnailImage controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Error retrieving thumbnail image',
        error: error.message
      });
    }
  }
};

module.exports = imageController;
