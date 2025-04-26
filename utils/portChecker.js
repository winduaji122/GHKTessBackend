const net = require('net');
const { exec } = require('child_process');
const { logger } = require('./logger');

/**
 * Memeriksa apakah port sudah digunakan
 * @param {number} port - Port yang akan diperiksa
 * @returns {Promise<boolean>} - true jika port tersedia, false jika sudah digunakan
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(`Port ${port} sudah digunakan`, { service: 'port-checker' });
        resolve(false);
      } else {
        logger.error(`Error memeriksa port ${port}:`, { error: err.message, service: 'port-checker' });
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close();
      logger.info(`Port ${port} tersedia`, { service: 'port-checker' });
      resolve(true);
    });
    
    server.listen(port);
  });
}

/**
 * Menemukan proses yang menggunakan port tertentu (Windows)
 * @param {number} port - Port yang akan diperiksa
 * @returns {Promise<number|null>} - PID proses atau null jika tidak ditemukan
 */
function findProcessUsingPort(port) {
  return new Promise((resolve) => {
    // Command untuk Windows
    const command = `netstat -ano | findstr :${port}`;
    
    exec(command, (error, stdout) => {
      if (error || !stdout) {
        logger.warn(`Tidak dapat menemukan proses yang menggunakan port ${port}`, { service: 'port-checker' });
        resolve(null);
        return;
      }
      
      try {
        // Parse output untuk mendapatkan PID
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (line.includes(`LISTENING`)) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            logger.info(`Proses dengan PID ${pid} menggunakan port ${port}`, { service: 'port-checker' });
            resolve(parseInt(pid, 10));
            return;
          }
        }
        resolve(null);
      } catch (parseError) {
        logger.error(`Error parsing netstat output:`, { error: parseError.message, service: 'port-checker' });
        resolve(null);
      }
    });
  });
}

/**
 * Menghentikan proses dengan PID tertentu (Windows)
 * @param {number} pid - PID proses yang akan dihentikan
 * @returns {Promise<boolean>} - true jika berhasil, false jika gagal
 */
function killProcess(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve(false);
      return;
    }
    
    // Command untuk Windows
    const command = `taskkill /F /PID ${pid}`;
    
    exec(command, (error) => {
      if (error) {
        logger.error(`Gagal menghentikan proses dengan PID ${pid}:`, { error: error.message, service: 'port-checker' });
        resolve(false);
        return;
      }
      
      logger.info(`Berhasil menghentikan proses dengan PID ${pid}`, { service: 'port-checker' });
      resolve(true);
    });
  });
}

/**
 * Membersihkan port jika sudah digunakan
 * @param {number} port - Port yang akan dibersihkan
 * @returns {Promise<boolean>} - true jika port berhasil dibersihkan atau sudah tersedia, false jika gagal
 */
async function cleanupPort(port) {
  try {
    // Periksa apakah port tersedia
    const isAvailable = await isPortAvailable(port);
    if (isAvailable) {
      return true;
    }
    
    // Jika port tidak tersedia, cari proses yang menggunakannya
    const pid = await findProcessUsingPort(port);
    if (!pid) {
      logger.warn(`Tidak dapat menemukan proses yang menggunakan port ${port}`, { service: 'port-checker' });
      return false;
    }
    
    // Hentikan proses
    const killed = await killProcess(pid);
    if (!killed) {
      logger.error(`Gagal menghentikan proses yang menggunakan port ${port}`, { service: 'port-checker' });
      return false;
    }
    
    // Periksa lagi apakah port sudah tersedia
    const isNowAvailable = await isPortAvailable(port);
    if (!isNowAvailable) {
      logger.warn(`Port ${port} masih digunakan setelah menghentikan proses`, { service: 'port-checker' });
    }
    
    return isNowAvailable;
  } catch (error) {
    logger.error(`Error membersihkan port ${port}:`, { error: error.message, stack: error.stack, service: 'port-checker' });
    return false;
  }
}

module.exports = {
  isPortAvailable,
  findProcessUsingPort,
  killProcess,
  cleanupPort
};
