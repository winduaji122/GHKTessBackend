const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../utils/logger');
const { uploadDir, deleteFile, fileExists } = require('../uploadConfig');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');

exports.uploadImage = async (req, res) => {
  try {
    console.log('Upload image request received');
    
    if (!req.file) {
      console.log('No file received');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }
    
    console.log('File received:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    });
    
    // Format path untuk response
    const relativePath = req.file.path.replace(/\\/g, '/');
    console.log('Formatted path:', relativePath);
    
    return res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      path: relativePath,
      filename: path.basename(req.file.path),
      mimetype: req.file.mimetype,
      size: req.file.size
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

exports.deleteImage = async (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Validasi filename
    if (!filename || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({
        success: false,
        message: 'Nama file tidak valid'
      });
    }

    const filepath = path.join(uploadDir, path.basename(filename));

    // Gunakan fungsi deleteFile dari uploadConfig
    const deleted = await deleteFile(filename);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'File tidak ditemukan atau gagal dihapus'
      });
    }

    logger.info(`File berhasil dihapus: ${filename}`, {
      service: 'upload-service',
      filename,
      deletedBy: req.user?.id || 'unknown'
    });

    res.json({
      success: true,
      message: 'File berhasil dihapus'
    });

  } catch (error) {
    logger.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menghapus file'
    });
  }
};

exports.getImage = async (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Validasi filename
    if (!filename || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({
        success: false,
        message: 'Nama file tidak valid'
      });
    }

    const filepath = path.join(uploadDir, path.basename(filename));

    // Gunakan fileExists dari uploadConfig
    const exists = await fileExists(filename);
    
    if (!exists) {
      logger.warn(`File tidak ditemukan: ${filename}`, {
        service: 'upload-service',
        path: filepath
      });
      return res.status(404).json({
        success: false,
        message: 'File tidak ditemukan'
      });
    }

    // Set cache headers
    res.set({
      'Cache-Control': 'public, max-age=31536000',
      'Content-Type': mime.lookup(filepath) || 'application/octet-stream'
    });

    res.sendFile(filepath);
    
  } catch (error) {
    logger.error('Error serving file:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil file'
    });
  }
}; 