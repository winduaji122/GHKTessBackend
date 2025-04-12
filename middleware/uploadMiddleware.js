const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../utils/logger');

// Definisikan path uploads dengan jelas
const uploadDir = path.join(__dirname, '../uploads');

// Konfigurasi storage
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      // Cek dan pastikan folder ada
      await fs.access(uploadDir);
      logger.info('Upload directory accessed:', { path: uploadDir });
      cb(null, uploadDir);
    } catch (error) {
      logger.error('Upload directory error:', { 
        path: uploadDir,
        error: error.message 
      });
      cb(new Error('Upload directory not accessible'));
    }
  },
  filename: (req, file, cb) => {
    // Format nama file yang konsisten
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    
    const filename = `${timestamp}-${random}${ext}`;
    
    logger.info('Generating filename:', {
      originalName: file.originalname,
      generatedName: filename
    });
    
    cb(null, filename);
  }
});

// File filter untuk validasi
const fileFilter = (req, file, cb) => {
  // Validasi tipe file
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  
  if (!allowedTypes.includes(file.mimetype)) {
    logger.warn('Invalid file type:', { 
      mimetype: file.mimetype,
      filename: file.originalname 
    });
    return cb(new Error('Invalid file type'), false);
  }

  cb(null, true);
};

// Konfigurasi multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
}).single('image');

// Middleware wrapper dengan error handling
const uploadMiddleware = (req, res, next) => {
  upload(req, res, function(err) {
    if (err instanceof multer.MulterError) {
      logger.error('Multer error:', { error: err.message });
      return res.status(400).json({
        success: false,
        message: `Upload error: ${err.message}`
      });
    } else if (err) {
      logger.error('Upload error:', { error: err.message });
      return res.status(500).json({
        success: false,
        message: `Upload failed: ${err.message}`
      });
    }

    // Log successful upload
    if (req.file) {
      logger.info('File uploaded successfully:', {
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
        path: req.file.path
      });
    }

    next();
  });
};

module.exports = uploadMiddleware; 