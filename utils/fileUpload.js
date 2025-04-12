const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { logger } = require('./logger');

// Direktori untuk upload
const uploadDir = path.join(__dirname, '..', 'uploads');
const carouselDir = path.join(uploadDir, 'carousel');

// Pastikan direktori upload ada
const ensureDirectoryExists = async (directory) => {
  try {
    await fs.access(directory);
  } catch (error) {
    // Direktori tidak ada, buat baru
    await fs.mkdir(directory, { recursive: true });
    logger.info(`Directory created: ${directory}`);
  }
};

// Upload gambar
const uploadImage = async (file, subDir = '') => {
  try {
    // Pastikan direktori upload ada
    const targetDir = subDir ? path.join(uploadDir, subDir) : uploadDir;
    await ensureDirectoryExists(targetDir);

    // Generate nama file unik
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    const fileExtension = path.extname(file.originalname).toLowerCase();
    const fileName = `${subDir ? subDir + '-' : ''}${timestamp}-${randomString}${fileExtension}`;
    const filePath = path.join(targetDir, fileName);

    // Tulis file
    await fs.writeFile(filePath, file.buffer);

    // Return path relatif untuk disimpan di database
    return `${subDir ? subDir + '/' : ''}${fileName}`;
  } catch (error) {
    logger.error('Error uploading file:', error);
    throw new Error('Failed to upload file');
  }
};

// Hapus gambar
const deleteImage = async (filePath) => {
  try {
    if (!filePath) return false;

    // Pastikan path aman (tidak ada ../ dll)
    const normalizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(uploadDir, normalizedPath);

    // Cek apakah file ada
    await fs.access(fullPath);
    
    // Hapus file
    await fs.unlink(fullPath);
    logger.info(`File deleted: ${fullPath}`);
    return true;
  } catch (error) {
    logger.error(`Error deleting file ${filePath}:`, error);
    return false;
  }
};

module.exports = {
  uploadImage,
  deleteImage,
  ensureDirectoryExists,
  uploadDir,
  carouselDir
};
