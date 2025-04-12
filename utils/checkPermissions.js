const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./logger');

const checkUploadPermissions = async () => {
  const uploadDir = path.join(__dirname, '../uploads');
  
  try {
    // Cek apakah folder exists
    try {
      await fs.access(uploadDir);
      logger.info('Upload directory exists:', { path: uploadDir });
    } catch {
      // Buat folder jika tidak ada
      await fs.mkdir(uploadDir, { recursive: true, mode: 0o755 });
      logger.info('Created upload directory:', { path: uploadDir });
    }

    // Cek permission
    const stats = await fs.stat(uploadDir);
    const mode = stats.mode & 0o777; // Get permission bits
    
    logger.info('Upload directory permissions:', {
      path: uploadDir,
      mode: mode.toString(8),
      owner: {
        read: !!(mode & 0o400),
        write: !!(mode & 0o200),
        execute: !!(mode & 0o100)
      },
      group: {
        read: !!(mode & 0o40),
        write: !!(mode & 0o20),
        execute: !!(mode & 0o10)
      },
      others: {
        read: !!(mode & 0o4),
        write: !!(mode & 0o2),
        execute: !!(mode & 0o1)
      }
    });

    // Test write permission
    const testFile = path.join(uploadDir, '.permission-test');
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    
    logger.info('Upload directory is writable');
    return true;

  } catch (error) {
    logger.error('Upload directory permission error:', {
      path: uploadDir,
      error: error.message,
      stack: error.stack
    });
    return false;
  }
};

module.exports = { checkUploadPermissions }; 