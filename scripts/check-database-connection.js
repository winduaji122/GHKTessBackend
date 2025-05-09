/**
 * Script untuk memeriksa koneksi database
 *
 * Cara menjalankan:
 * node scripts/check-database-connection.js
 */

const mysql = require('mysql2/promise');

// Konfigurasi database
const dbConfig = {
  host: 'hopper.proxy.rlwy.net',
  port: 59942,
  user: 'root',
  password: 'MOOANaYOrdGrDIRNsFCfjXlsierCZXdX',
  database: 'mydatabase',
  ssl: false,
  connectTimeout: 60000, // Timeout 60 detik
  acquireTimeout: 60000,
  timeout: 60000
};

// Fungsi untuk memeriksa koneksi database
async function checkDatabaseConnection() {
  let connection;
  let retries = 3; // Jumlah percobaan koneksi

  while (retries > 0) {
    try {
      console.log(`Menghubungkan ke database... (percobaan ke-${4-retries})`);
      console.log(`Host: ${dbConfig.host}, Port: ${dbConfig.port}, Database: ${dbConfig.database}`);

      // Buat koneksi ke database
      connection = await mysql.createConnection(dbConfig);
      console.log('Berhasil terhubung ke database!');

      // Cek versi database
      const [rows] = await connection.execute('SELECT VERSION() as version');
      console.log(`Versi MySQL: ${rows[0].version}`);

      // Cek tabel yang ada
      const [tables] = await connection.execute('SHOW TABLES');
      console.log('Tabel yang tersedia:');
      tables.forEach((table, index) => {
        const tableName = table[`Tables_in_${dbConfig.database}`];
        console.log(`${index + 1}. ${tableName}`);
      });

      // Cek jumlah data di beberapa tabel utama
      console.log('\nStatistik data:');

      // Cek jumlah post
      const [postCount] = await connection.execute('SELECT COUNT(*) as count FROM posts');
      console.log(`- Posts: ${postCount[0].count} baris`);

      // Cek jumlah gambar
      const [imageCount] = await connection.execute('SELECT COUNT(*) as count FROM images');
      console.log(`- Images: ${imageCount[0].count} baris`);

      // Cek jumlah label (menggunakan unique_labels)
      const [labelCount] = await connection.execute('SELECT COUNT(*) as count FROM unique_labels');
      console.log(`- Labels: ${labelCount[0].count} baris`);

      // Cek jumlah user
      const [userCount] = await connection.execute('SELECT COUNT(*) as count FROM users');
      console.log(`- Users: ${userCount[0].count} baris`);

      // Cek post dengan gambar
      const [postsWithImage] = await connection.execute('SELECT COUNT(*) as count FROM posts WHERE image IS NOT NULL');
      console.log(`- Posts dengan gambar: ${postsWithImage[0].count} baris`);

      // Cek format penyimpanan gambar di tabel posts
      console.log('\nFormat penyimpanan gambar di tabel posts:');
      const [imageFormatRows] = await connection.execute(
        `SELECT
           CASE
             WHEN image LIKE 'http%' THEN 'URL lengkap'
             WHEN image LIKE 'image-%' THEN 'Path relatif (image-)'
             WHEN image REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID'
             WHEN image LIKE 'uploads/%' THEN 'Path relatif (uploads/)'
             ELSE 'Format lain'
           END AS format,
           COUNT(*) AS jumlah
         FROM posts
         WHERE image IS NOT NULL
         GROUP BY format`
      );

      if (imageFormatRows.length === 0) {
        console.log('Tidak dapat menentukan format penyimpanan gambar.');
      } else {
        console.table(imageFormatRows);
      }

      // Cek relasi antara posts dan images (tanpa join karena masalah collation)
      console.log('\nRelasi antara posts dan images:');

      // Ambil post dengan UUID
      const [postsWithUuid] = await connection.execute(
        `SELECT COUNT(*) as count
         FROM posts
         WHERE image IS NOT NULL AND image REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`
      );

      // Ambil jumlah image
      const [imagesCount] = await connection.execute(
        `SELECT COUNT(*) as count
         FROM images`
      );

      // Tampilkan hasil
      console.log(`- Posts dengan UUID sebagai image: ${postsWithUuid[0].count}`);
      console.log(`- Total images di tabel images: ${imagesCount[0].count}`);

      break; // Keluar dari loop jika berhasil
    } catch (error) {
      retries--;
      console.error(`Error saat menghubungkan ke database: ${error.message}`);

      if (retries === 0) {
        console.error('Gagal menghubungkan ke database setelah beberapa percobaan.');
        process.exit(1);
      }

      console.log(`Mencoba kembali dalam 5 detik... (${retries} percobaan tersisa)`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Tunggu 5 detik
    } finally {
      if (connection) {
        console.log('Menutup koneksi database...');
        await connection.end();
      }
    }
  }
}

// Jalankan fungsi
checkDatabaseConnection().catch(error => {
  console.error('Error tidak tertangani:', error);
  process.exit(1);
});
