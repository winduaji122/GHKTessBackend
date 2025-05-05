const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('./logger');
const { uploadDir } = require('../uploadConfig');

// Format image URL
const formatImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;

  // Fix double uploads in path
  if (imagePath.includes('/uploads/uploads/')) {
    imagePath = imagePath.replace('/uploads/uploads/', '/uploads/');
  }

  if (imagePath.startsWith('/uploads/')) {
    return `${process.env.API_URL || process.env.BASE_URL || 'http://localhost:5000'}${imagePath}`;
  }

  return `${process.env.API_URL || process.env.BASE_URL || 'http://localhost:5000'}/uploads/${path.basename(imagePath)}`;
};

// Optimize and save image
const optimizeAndSaveImage = async (file) => {
  try {
    if (!file) {
      logger.warn('No file provided for optimization');
      return null;
    }

    const optimizedFileName = `optimized-${Date.now()}-${file.originalname}`;
    const outputPath = path.join(uploadDir, optimizedFileName);

    // Hanya log di development mode
    if (process.env.NODE_ENV !== 'production') {
      logger.info('Starting image optimization', {
        originalName: file.originalname,
        outputPath: optimizedFileName,
        size: file.size
      });
    }

    // Deteksi tipe gambar untuk optimasi yang lebih baik
    let imageProcessor = sharp(file.path);

    // Resize gambar dengan mempertahankan aspek ratio
    imageProcessor = imageProcessor.resize({
      width: 800,
      height: 800,
      fit: 'inside',
      withoutEnlargement: true
    });

    // Optimasi berdasarkan tipe file
    const fileExt = path.extname(file.originalname).toLowerCase();

    if (fileExt === '.png') {
      // Optimasi untuk PNG
      imageProcessor = imageProcessor.png({
        compressionLevel: 8,
        adaptiveFiltering: true,
        palette: true
      });
    } else if (fileExt === '.gif') {
      // Konversi GIF ke PNG untuk ukuran lebih kecil
      imageProcessor = imageProcessor.png({
        compressionLevel: 8
      });
    } else {
      // Default ke JPEG untuk format lain
      imageProcessor = imageProcessor.jpeg({
        quality: 80,
        progressive: true
      });
    }

    // Proses dan simpan gambar
    await imageProcessor.toFile(outputPath);

    // Hapus file asli setelah optimasi
    try {
      await fs.unlink(file.path);
    } catch (unlinkError) {
      // Hanya log di development mode
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Failed to delete original file', {
          error: unlinkError.message,
          file: file.path
        });
      }
    }

    // Hanya log di development mode
    if (process.env.NODE_ENV !== 'production') {
      logger.info('Image optimization completed', {
        filename: optimizedFileName
      });
    }

    return optimizedFileName;
  } catch (error) {
    logger.error('Image optimization failed', {
      error: error.message,
      file: file?.originalname
    });

    // Jika optimasi gagal, gunakan file asli
    return file?.filename || null;
  }
};

// Delete image file
const deleteImageFile = async (filename) => {
  if (!filename) {
    logger.warn('No filename provided for deletion');
    return false;
  }

  const filepath = path.join(uploadDir, path.basename(filename));
  try {
    await fs.access(filepath);
    await fs.unlink(filepath);
    logger.info('File deleted successfully', { filename });
    return true;
  } catch (error) {
    logger.warn('File deletion failed', {
      filename,
      error: error.message
    });
    return false;
  }
};

// Validate image existence
const validateImage = async (imagePath) => {
  try {
    if (!imagePath) {
      logger.warn('No image path provided for validation');
      return false;
    }
    const filepath = path.join(uploadDir, path.basename(imagePath));
    await fs.access(filepath);
    logger.info('Image validated successfully', { imagePath });
    return true;
  } catch (error) {
    logger.warn('Image validation failed', {
      imagePath,
      error: error.message
    });
    return false;
  }
};

module.exports = {
  formatImageUrl,
  optimizeAndSaveImage,
  deleteImageFile,
  validateImage
};