const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { isAuthenticated, isAdminOrWriter } = require('../middleware/authMiddleware');
const uploadController = require('../controllers/uploadController');
const logger = require('../utils/logger');

// Konfigurasi penyimpanan
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    console.log('Upload destination:', uploadDir);
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const filename = 'image-' + uniqueSuffix + ext;
    
    console.log('Generated filename:', filename);
    
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: function(req, file, cb) {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WEBP are allowed.'));
    }
  }
});

// Route untuk upload gambar
router.post('/', isAuthenticated, isAdminOrWriter, upload.single('image'), (req, res) => {
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
      filename: req.file.filename,
      path: req.file.path
    });
    
    // Format path untuk response
    const relativePath = req.file.path.replace(/\\/g, '/').replace(/^.*\/uploads\//, 'uploads/');
    console.log('Formatted relative path:', relativePath);
    
    return res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      path: relativePath,
      filename: req.file.filename
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Route untuk menghapus gambar
router.delete('/:filename',
  isAuthenticated,
  async (req, res, next) => {
    // Validasi filename
    const filename = req.params.filename;
    if (!filename || filename.includes('..')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filename'
      });
    }
    next();
  },
  uploadController.deleteImage
);

// Route untuk mengambil gambar (opsional, jika tidak menggunakan static middleware)
router.get('/:filename',
  (req, res, next) => {
    res.set({
      'Cache-Control': 'public, max-age=31536000',
      'Expires': new Date(Date.now() + 31536000000).toUTCString()
    });
    next();
  },
  uploadController.getImage
);

// Tambahkan error handler
router.use((error, req, res, next) => {
  logger.error('Upload route error:', {
    service: 'user-service',
    error: error.message,
    stack: error.stack
  });

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: error.message
  });
});

module.exports = router; 