const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const Image = require('../models/Image');
const { logger } = require('../utils/logger');

// Konfigurasi ukuran gambar
const IMAGE_SIZES = {
  thumbnail: { width: 200, height: 200, fit: 'cover' },
  medium: { width: 640, height: null, fit: 'inside' },
  original: { width: null, height: null }
};

// Konfigurasi kualitas kompresi
const COMPRESSION_OPTIONS = {
  jpeg: { quality: 80 },
  png: { compressionLevel: 8 },
  webp: { quality: 80 }
};

// Konstanta akan diekspor melalui class ImageService

class ImageService {
  /**
   * Memproses dan mengompresi gambar yang diupload
   * @param {Object} file - File yang diupload (dari multer)
   * @param {Object} options - Opsi tambahan (userId, postId, dll)
   * @returns {Promise<Object>} - Metadata gambar yang telah diproses
   */
  static async processImage(file, options = {}) {
    try {
      const { userId, postId, storageType = 'local' } = options;

      // Buat direktori jika belum ada
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      await this.ensureDirectoryExists(uploadsDir);

      // Buat subdirektori untuk versi gambar
      const originalDir = path.join(uploadsDir, 'original');
      const thumbnailDir = path.join(uploadsDir, 'thumbnail');
      const mediumDir = path.join(uploadsDir, 'medium');

      await this.ensureDirectoryExists(originalDir);
      await this.ensureDirectoryExists(thumbnailDir);
      await this.ensureDirectoryExists(mediumDir);

      // Generate unique ID untuk gambar
      const imageId = uuidv4();
      const fileExt = path.extname(file.originalname).toLowerCase();
      const baseFilename = `${imageId}${fileExt}`;

      // Path untuk setiap versi gambar
      const originalPath = path.join(originalDir, baseFilename);
      const thumbnailPath = path.join(thumbnailDir, baseFilename);
      const mediumPath = path.join(mediumDir, baseFilename);

      // Baca metadata gambar
      const metadata = await sharp(file.path).metadata();

      // Proses gambar untuk setiap ukuran
      const originalPromise = this.resizeAndSave(file.path, originalPath, IMAGE_SIZES.original, metadata.format);
      const thumbnailPromise = this.resizeAndSave(file.path, thumbnailPath, IMAGE_SIZES.thumbnail, metadata.format);
      const mediumPromise = this.resizeAndSave(file.path, mediumPath, IMAGE_SIZES.medium, metadata.format);

      await Promise.all([originalPromise, thumbnailPromise, mediumPromise]);

      // Hapus file temporary dari multer
      await fs.unlink(file.path);

      // Simpan metadata ke database
      const imageData = {
        id: imageId,
        originalFilename: file.originalname,
        originalPath: `uploads/original/${baseFilename}`,
        thumbnailPath: `uploads/thumbnail/${baseFilename}`,
        mediumPath: `uploads/medium/${baseFilename}`,
        mimeType: file.mimetype,
        size: file.size,
        width: metadata.width,
        height: metadata.height,
        userId,
        postId,
        storageType
      };

      const savedImage = await Image.create(imageData);

      return {
        id: savedImage.id,
        originalUrl: `/uploads/original/${baseFilename}`,
        thumbnailUrl: `/uploads/thumbnail/${baseFilename}`,
        mediumUrl: `/uploads/medium/${baseFilename}`,
        width: metadata.width,
        height: metadata.height,
        size: file.size,
        format: metadata.format
      };
    } catch (error) {
      logger.error('Error processing image:', error);
      throw error;
    }
  }

  /**
   * Resize dan simpan gambar
   * @param {string} sourcePath - Path file sumber
   * @param {string} targetPath - Path file target
   * @param {Object} size - Konfigurasi ukuran
   * @param {string} format - Format gambar
   * @returns {Promise<void>}
   */
  static async resizeAndSave(sourcePath, targetPath, size, format) {
    try {
      let sharpInstance = sharp(sourcePath);

      // Resize jika diperlukan
      if (size.width || size.height) {
        sharpInstance = sharpInstance.resize({
          width: size.width,
          height: size.height,
          fit: size.fit || 'cover',
          withoutEnlargement: true
        });
      }

      // Pilih format output dan opsi kompresi
      const outputFormat = format.toLowerCase();

      if (outputFormat === 'jpeg' || outputFormat === 'jpg') {
        sharpInstance = sharpInstance.jpeg(COMPRESSION_OPTIONS.jpeg);
      } else if (outputFormat === 'png') {
        sharpInstance = sharpInstance.png(COMPRESSION_OPTIONS.png);
      } else if (outputFormat === 'webp') {
        sharpInstance = sharpInstance.webp(COMPRESSION_OPTIONS.webp);
      }

      // Simpan gambar
      await sharpInstance.toFile(targetPath);
    } catch (error) {
      logger.error(`Error resizing image to ${targetPath}:`, error);
      throw error;
    }
  }

  /**
   * Pastikan direktori ada, buat jika belum ada
   * @param {string} dir - Path direktori
   * @returns {Promise<void>}
   */
  static async ensureDirectoryExists(dir) {
    try {
      await fs.access(dir);
    } catch (error) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Hapus gambar dari storage dan database
   * @param {string} imageId - ID gambar
   * @returns {Promise<boolean>} - Status keberhasilan
   */
  static async deleteImage(imageId) {
    try {
      const image = await Image.findById(imageId);

      if (!image) {
        return false;
      }

      // Hapus file dari storage
      const basePath = path.join(__dirname, '..');
      const filesToDelete = [
        path.join(basePath, image.original_path),
        path.join(basePath, image.thumbnail_path),
        path.join(basePath, image.medium_path)
      ];

      for (const filePath of filesToDelete) {
        try {
          await fs.access(filePath);
          await fs.unlink(filePath);
        } catch (error) {
          logger.warn(`Could not delete file ${filePath}:`, error);
        }
      }

      // Hapus record dari database
      return await Image.delete(imageId);
    } catch (error) {
      logger.error(`Error deleting image ${imageId}:`, error);
      throw error;
    }
  }
}

// Ekspor konstanta untuk digunakan oleh script migrasi
ImageService.IMAGE_SIZES = IMAGE_SIZES;
ImageService.COMPRESSION_OPTIONS = COMPRESSION_OPTIONS;

module.exports = ImageService;
