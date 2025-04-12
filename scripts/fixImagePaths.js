require('dotenv').config({ path: '../.env' });
const { executeQuery } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;
const baseUrl = process.env.BASE_URL || 'http://localhost:5000';

const uploadDir = path.join(__dirname, '..', 'uploads');

async function fixImagePaths() {
  try {
    await executeQuery(async () => {
      logger.info('Memulai proses perbaikan path gambar...');

      // Ambil semua post dari database
      const posts = await executeQuery('SELECT id, image FROM posts WHERE image IS NOT NULL');

      for (const post of posts) {
        const oldImagePath = post.image;
        if (!oldImagePath) continue;

        // Periksa apakah path gambar sudah benar
        if (oldImagePath.startsWith('http://') || oldImagePath.startsWith('https://')) {
          logger.info(`Path gambar untuk post ${post.id} sudah benar: ${oldImagePath}`);
          continue;
        }

        // Dapatkan nama file dari path lama
        const fileName = path.basename(oldImagePath);

        // Buat path baru
        const newImagePath = path.join(uploadDir, fileName);

        // Periksa apakah file ada di direktori uploads
        try {
          await fs.access(newImagePath);
        } catch (error) {
          logger.warn(`File tidak ditemukan untuk post ${post.id}: ${newImagePath}`);
          continue;
        }

        // Update path gambar di database
        const newRelativePath = `/uploads/${fileName}`;
        const newAbsolutePath = `${baseUrl}${newRelativePath}`;
        await executeQuery('UPDATE posts SET image = ? WHERE id = ?', [newAbsolutePath, post.id]);

        logger.info(`Path gambar diperbarui untuk post ${post.id}: ${newAbsolutePath}`);
      }

      logger.info('Proses perbaikan path gambar selesai.');
    });
  } catch (error) {
    logger.error('Terjadi kesalahan saat memperbaiki path gambar:', error);
  }
}

fixImagePaths().then(() => {
  logger.info('Script fixImagePaths selesai dijalankan.');
  process.exit(0);
}).catch((error) => {
  logger.error('Terjadi kesalahan saat menjalankan script fixImagePaths:', error);
  process.exit(1);
});