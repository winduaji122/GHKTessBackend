const { executeQuery } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');

/**
 * Membersihkan token yang sudah expired atau di-revoke dari database
 * @returns {Promise<{success: boolean, count: number}>} Hasil operasi cleanup
 */
const cleanupTokens = async () => {
  try {
    logger.info('Memulai proses cleanup token');
    
    // Dapatkan jumlah token sebelum cleanup untuk reporting
    const beforeCount = await getTokenCount();
    
    // Hapus token yang expired atau di-revoke
    const result = await executeQuery(`
      DELETE FROM user_tokens 
      WHERE expires_at < NOW() 
      OR is_revoked = 1
    `);
    
    const deletedCount = result.affectedRows || 0;
    
    logger.info('Token cleanup selesai', { 
      deletedCount, 
      beforeCount,
      afterCount: beforeCount - deletedCount
    });
    
    return {
      success: true,
      count: deletedCount
    };
  } catch (error) {
    logger.error('Token cleanup gagal', {
      error: error.message,
      stack: error.stack,
      code: error.code
    });
    
    return {
      success: false,
      count: 0,
      error: error.message
    };
  }
};

/**
 * Fungsi helper untuk logging yang aman
 * @param {string} level - Level log (info, error, warn, debug)
 * @param {string} message - Pesan log
 * @param {object} data - Data tambahan (opsional)
 */
const logSafely = (level, message, data = {}) => {
  if (logger && typeof logger[level] === 'function') {
    logger[level](message, data);
  } else {
    if (level === 'error') {
      console.error(message, data);
    } else if (level === 'warn') {
      console.warn(message, data);
    } else {
      console.log(`[${level.toUpperCase()}] ${message}`, data);
    }
  }
};

/**
 * Mendapatkan jumlah token dalam database
 * @returns {Promise<number>} Jumlah token
 */
const getTokenCount = async () => {
  try {
    const result = await executeQuery('SELECT COUNT(*) as count FROM user_tokens');
    return result[0]?.count || 0;
  } catch (error) {
    logger.error('Gagal mendapatkan jumlah token', {
      error: error.message,
      stack: error.stack
    });
    return 0;
  }
};

/**
 * Mendapatkan statistik token
 * @returns {Promise<Object>} Statistik token
 */
const getTokenStats = async () => {
  try {
    const stats = await executeQuery(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN expires_at < NOW() THEN 1 ELSE 0 END) as expired,
        SUM(CASE WHEN is_revoked = 1 THEN 1 ELSE 0 END) as revoked,
        SUM(CASE WHEN type = 'refresh' THEN 1 ELSE 0 END) as refresh_tokens,
        SUM(CASE WHEN type = 'access' THEN 1 ELSE 0 END) as access_tokens
      FROM user_tokens
    `);
    
    const statsData = stats[0] || {
      total: 0,
      expired: 0,
      revoked: 0,
      refresh_tokens: 0,
      access_tokens: 0
    };
    
    logger.info('Token statistics retrieved', statsData);
    
    return statsData;
  } catch (error) {
    logger.error('Gagal mendapatkan statistik token', {
      error: error.message,
      stack: error.stack
    });
    return {
      total: 0,
      error: error.message
    };
  }
};

/**
 * Menghapus token berdasarkan user ID
 * @param {string|number} userId - ID user
 * @returns {Promise<{success: boolean, count: number}>} Hasil operasi
 */
const revokeUserTokens = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID diperlukan');
    }
    
    const result = await executeQuery(
      `UPDATE user_tokens 
      SET is_revoked = 1 
      WHERE user_id = ?`,
      [userId]
    );
    
    logger.info('Token user di-revoke', { 
      userId, 
      affectedRows: result.affectedRows || 0 
    });
    
    return {
      success: true,
      count: result.affectedRows || 0
    };
  } catch (error) {
    logger.error('Gagal me-revoke token user', {
      userId,
      error: error.message,
      stack: error.stack
    });
    return {
      success: false,
      count: 0,
      error: error.message
    };
  }
};

// Jalankan cleanup setiap jam
const ONE_HOUR = 60 * 60 * 1000;
let cleanupInterval;

/**
 * Memulai proses cleanup otomatis
 * @param {number} interval - Interval dalam milidetik
 */
const startCleanupSchedule = (interval = ONE_HOUR) => {
  logger.info('Memulai jadwal cleanup', { id, intervalMinutes: interval/1000/60 });
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
  
  // Jalankan cleanup pertama kali
  cleanupTokens()
    .then(result => {
      if (result.success) {
        logger.info('Cleanup awal berhasil', { 
          deletedCount: result.count 
        });
      }
    })
    .catch(error => {
      logger.error('Error pada cleanup awal', {
        error: error.message,
        stack: error.stack
      });
    });
  
  // Set interval untuk cleanup berikutnya
  cleanupInterval = setInterval(async () => {
    try {
      const stats = await getTokenStats();
      logger.info('Statistik token sebelum cleanup', stats);
      
      const result = await cleanupTokens();
      
      if (result.success) {
        logger.info('Cleanup terjadwal berhasil', { 
          deletedCount: result.count 
        });
      }
    } catch (error) {
      logger.error('Error pada cleanup terjadwal', {
        error: error.message,
        stack: error.stack
      });
    }
  }, interval);
  
  logger.info('Cleanup token dijadwalkan', { 
    intervalMinutes: interval/1000/60,
    nextCleanup: new Date(Date.now() + interval).toISOString()
  });
  
  return cleanupInterval;
};

/**
 * Menghentikan proses cleanup otomatis
 */
const stopCleanupSchedule = () => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info('Cleanup token dijadwalkan dihentikan');
    return true;
  }
  return false;
};

// Export fungsi-fungsi
module.exports = {
  cleanupTokens,
  getTokenCount,
  getTokenStats,
  revokeUserTokens,
  startCleanupSchedule,
  stopCleanupSchedule
};
