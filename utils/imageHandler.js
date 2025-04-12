const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('./logger');
const { uploadDir } = require('../uploadConfig');

// Format image URL
const formatImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  return `${process.env.BASE_URL}/uploads/${path.basename(imagePath)}`;
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

    logger.info('Starting image optimization', {
      originalName: file.originalname,
      outputPath: optimizedFileName,
      size: file.size
    });

    await sharp(file.path)
      .resize(800)
      .jpeg({ quality: 80 })
      .toFile(outputPath);

    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
      await fs.unlink(file.path);
    } catch (unlinkError) {
      logger.warn('Failed to delete original file', {
        error: unlinkError.message,
        file: file.path
      });
    }
    
    logger.info('Image optimization completed', {
      filename: optimizedFileName
    });
    
    return optimizedFileName;
  } catch (error) {
    logger.error('Image optimization failed', {
      error: error.message,
      stack: error.stack,
      file: file?.originalname
    });
    
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