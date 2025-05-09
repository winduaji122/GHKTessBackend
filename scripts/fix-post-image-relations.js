/**
 * Script untuk memperbaiki relasi antara tabel posts dan tabel images
 *
 * Fungsi script ini:
 * 1. Memeriksa semua post di database
 * 2. Memastikan setiap post yang memiliki gambar memiliki relasi yang benar di tabel images
 * 3. Mengupdate kolom post_id di tabel images
 *
 * Cara menjalankan:
 * node scripts/fix-post-image-relations.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

// Konfigurasi database
const dbConfig = {
  host: process.env.DB_HOST || 'hopper.proxy.rlwy.net',
  port: process.env.DB_PORT || 59942,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'MOOANaYOrdGrDIRNsFCfjXlsierCZXdX',
  database: process.env.DB_NAME || 'mydatabase',
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false,
  connectTimeout: 60000, // Tambahkan timeout 60 detik
  acquireTimeout: 60000, // Tambahkan timeout akuisisi koneksi
  timeout: 60000 // Tambahkan timeout operasi
};

// Fungsi utama
async function fixPostImageRelations() {
  let connection;
  let retries = 3; // Jumlah percobaan koneksi

  while (retries > 0) {
    try {
      // Buat koneksi ke database
      console.log(`Menghubungkan ke database... (percobaan ke-${4-retries})`);
      console.log(`Host: ${dbConfig.host}, Port: ${dbConfig.port}, Database: ${dbConfig.database}`);
      connection = await mysql.createConnection(dbConfig);
      console.log('Berhasil terhubung ke database');
      break; // Keluar dari loop jika berhasil
    } catch (error) {
      retries--;
      console.error(`Error saat menghubungkan ke database: ${error.message}`);

      if (retries === 0) {
        console.error('Gagal menghubungkan ke database setelah beberapa percobaan.');
        throw error;
      }

      console.log(`Mencoba kembali dalam 5 detik... (${retries} percobaan tersisa)`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Tunggu 5 detik
    }
  }

  try {

    // Ambil semua post dari database
    console.log('Mengambil data post dari database...');
    const [posts] = await connection.execute('SELECT id, title, image FROM posts WHERE image IS NOT NULL');
    console.log(`Ditemukan ${posts.length} post dengan gambar`);

    // Ambil semua gambar dari database
    console.log('Mengambil data gambar dari database...');
    const [images] = await connection.execute('SELECT id, post_id FROM images');
    console.log(`Ditemukan ${images.length} gambar di database`);

    // Buat map untuk mempercepat pencarian
    const imageMap = new Map();
    images.forEach(image => {
      imageMap.set(image.id, image);
    });

    // Proses setiap post
    console.log('Memproses post...');
    let updatedCount = 0;
    let errorCount = 0;

    for (const post of posts) {
      try {
        console.log(`\nMemproses post: ${post.id} - ${post.title}`);
        console.log(`Image: ${post.image}`);

        // Cek apakah image adalah UUID
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidPattern.test(post.image)) {
          console.log('Format gambar: UUID');

          // Cek apakah UUID ada di tabel images
          if (imageMap.has(post.image)) {
            const image = imageMap.get(post.image);

            // Cek apakah post_id sudah benar
            if (image.post_id === post.id) {
              console.log('Relasi sudah benar');
            } else {
              console.log(`Mengupdate post_id dari ${image.post_id || 'NULL'} ke ${post.id}`);

              // Update post_id di tabel images
              await connection.execute(
                'UPDATE images SET post_id = ?, updated_at = NOW() WHERE id = ?',
                [post.id, post.image]
              );

              updatedCount++;
            }
          } else {
            console.log('UUID tidak ditemukan di tabel images');
            errorCount++;
          }
        } else {
          console.log('Format gambar bukan UUID, lewati');
        }
      } catch (error) {
        console.error(`Error memproses post ${post.id}: ${error.message}`);
        errorCount++;
      }
    }

    // Cari gambar yang tidak terkait dengan post manapun
    console.log('\nMencari gambar yang tidak terkait dengan post manapun...');
    const [orphanedImages] = await connection.execute('SELECT id FROM images WHERE post_id IS NULL');
    console.log(`Ditemukan ${orphanedImages.length} gambar yang tidak terkait dengan post manapun`);

    // Cari post yang tidak memiliki gambar di tabel images (tanpa join karena masalah collation)
    console.log('\nMencari post yang tidak memiliki gambar di tabel images...');

    // Ambil semua post dengan UUID
    const [postsWithUuid] = await connection.execute(`
      SELECT id, title, image
      FROM posts
      WHERE image IS NOT NULL AND image REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    `);

    // Ambil semua image IDs
    const [imageIds] = await connection.execute(`
      SELECT id FROM images
    `);

    // Buat set dari image IDs untuk pencarian cepat
    const imageIdSet = new Set();
    imageIds.forEach(img => {
      imageIdSet.add(img.id);
    });

    // Filter post yang UUID-nya tidak ada di tabel images
    const postsWithoutImages = postsWithUuid.filter(post => !imageIdSet.has(post.image));
    console.log(`Ditemukan ${postsWithoutImages.length} post yang tidak memiliki gambar di tabel images`);

    // Tampilkan beberapa contoh post yang tidak memiliki gambar di tabel images
    if (postsWithoutImages.length > 0) {
      console.log('\nContoh post yang tidak memiliki gambar di tabel images:');
      for (let i = 0; i < Math.min(5, postsWithoutImages.length); i++) {
        console.log(`- ${postsWithoutImages[i].id}: ${postsWithoutImages[i].title} (${postsWithoutImages[i].image})`);
      }
    }

    console.log('\nProses perbaikan relasi selesai');
    console.log(`Total post yang diproses: ${posts.length}`);
    console.log(`Post yang berhasil diupdate: ${updatedCount}`);
    console.log(`Post yang gagal diproses: ${errorCount}`);

  } catch (error) {
    console.error(`Error: ${error.message}`);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Koneksi database ditutup');
    }
  }
}

// Jalankan fungsi utama
fixPostImageRelations().catch(console.error);
