const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('./utils/logger');
const crypto = require('crypto');

// Gunakan direktori persisten di Render jika tersedia
const uploadDir = process.env.NODE_ENV === 'production' && process.env.RENDER_PERSISTENT_DIR
  ? path.join(process.env.RENDER_PERSISTENT_DIR, 'uploads')
  : path.join(__dirname, 'uploads');

// Inisialisasi direktori dengan error handling yang lebih baik
const initializeUploadDir = async () => {
  try {
    await fs.access(uploadDir);
    logger.info('Upload directory exists');
  } catch (error) {
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      logger.info('Upload directory created');
    } catch (mkdirError) {
      logger.error('Failed to create upload directory:', mkdirError);
      throw new Error('Failed to initialize upload directory');
    }
  }
};

// Panggil inisialisasi
initializeUploadDir();

// Tambahkan sanitasi filename
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .toLowerCase();
};

// Perbaikan storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueHash = crypto.randomBytes(8).toString('hex');
    const sanitizedName = sanitizeFilename(path.parse(file.originalname).name);
    const extension = path.extname(file.originalname).toLowerCase();
    const filename = `${Date.now()}-${uniqueHash}-${sanitizedName}${extension}`;
    cb(null, filename);
  }
});

// Perbaikan file filter dengan validasi yang lebih ketat
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (!allowedTypes.includes(file.mimetype)) {
    cb(new Error('Format file tidak didukung. Gunakan JPG, PNG, GIF, atau WEBP'), false);
    return;
  }

  if (file.size > maxSize) {
    cb(new Error('Ukuran file terlalu besar (maksimal 5MB)'), false);
    return;
  }

  cb(null, true);
};

// Konfigurasi multer dengan error handling yang lebih baik
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1 // Batasi 1 file per upload
  }
});

// Perbaikan error handler
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    logger.error('Multer error:', err);

    const errorMessages = {
      'LIMIT_FILE_SIZE': 'File terlalu besar (maksimal 5MB)',
      'LIMIT_FILE_COUNT': 'Terlalu banyak file',
      'LIMIT_UNEXPECTED_FILE': 'Field tidak sesuai',
      'LIMIT_FIELD_KEY': 'Field name terlalu panjang',
      'LIMIT_FIELD_VALUE': 'Field value terlalu panjang',
      'LIMIT_FIELD_COUNT': 'Terlalu banyak field',
      'LIMIT_PART_COUNT': 'Terlalu banyak parts'
    };

    return res.status(400).json({
      success: false,
      message: errorMessages[err.code] || 'Error upload file'
    });
  }

  if (err) {
    logger.error('Upload error:', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Error upload file'
    });
  }

  next();
};

// Perbaikan delete file dengan validasi path
const deleteFile = async (filename) => {
  try {
    if (!filename || filename.includes('..')) {
      throw new Error('Invalid filename');
    }

    const filepath = path.join(uploadDir, filename);
    const exists = await fs.access(filepath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      logger.warn(`File not found: ${filename}`);
      return false;
    }

    await fs.unlink(filepath);
    logger.info(`File deleted successfully: ${filename}`);
    return true;
  } catch (error) {
    logger.error(`Error deleting file ${filename}:`, error);
    return false;
  }
};

// Tambahkan utility function untuk check file existence
const fileExists = async (filename) => {
  try {
    await fs.access(path.join(uploadDir, filename));
    return true;
  } catch {
    return false;
  }
};

module.exports = {
  upload,
  uploadDir,
  handleMulterError,
  deleteFile,
  fileExists,
  initializeUploadDir
};