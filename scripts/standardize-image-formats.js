/**
 * Script untuk menstandardisasi format gambar di database
 *
 * Fungsi script ini:
 * 1. Memeriksa semua post di database
 * 2. Menstandardisasi format gambar di kolom 'image' tabel 'posts'
 * 3. Memastikan semua gambar terdaftar di tabel 'images'
 * 4. Mengupdate relasi antara post dan gambar
 *
 * Cara menjalankan:
 * node scripts/standardize-image-formats.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');

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

// Direktori uploads
const uploadsDir = path.join(__dirname, '..', 'uploads');
const originalDir = path.join(uploadsDir, 'original');
const mediumDir = path.join(uploadsDir, 'medium');
const thumbnailDir = path.join(uploadsDir, 'thumbnail');

// Fungsi untuk memastikan direktori ada
async function ensureDirectoryExists(dir) {
  try {
    await fs.access(dir);
  } catch (error) {
    await fs.mkdir(dir, { recursive: true });
    console.log(`Direktori ${dir} dibuat`);
  }
}

// Fungsi untuk memeriksa apakah file ada
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

// Fungsi untuk mendapatkan ekstensi file dari MIME type
function getExtensionFromMimeType(mimeType) {
  switch (mimeType) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    default:
      return '.jpg'; // Default ke jpg
  }
}

// Fungsi untuk memproses gambar
async function processImage(sourcePath, imageId, mimeType) {
  try {
    // Tentukan ekstensi file
    const extension = getExtensionFromMimeType(mimeType);
    const baseFilename = `${imageId}${extension}`;

    // Path untuk setiap ukuran
    const originalPath = path.join(originalDir, baseFilename);
    const mediumPath = path.join(mediumDir, baseFilename);
    const thumbnailPath = path.join(thumbnailDir, baseFilename);

    // Baca metadata gambar
    const metadata = await sharp(sourcePath).metadata();

    // Proses gambar untuk setiap ukuran
    await sharp(sourcePath)
      .resize({
        width: null,
        height: null,
        fit: 'inside',
        withoutEnlargement: true
      })
      .toFile(originalPath);

    await sharp(sourcePath)
      .resize({
        width: 640,
        height: null,
        fit: 'inside',
        withoutEnlargement: true
      })
      .toFile(mediumPath);

    await sharp(sourcePath)
      .resize({
        width: 200,
        height: 200,
        fit: 'cover'
      })
      .toFile(thumbnailPath);

    return {
      id: imageId,
      originalPath: `uploads/original/${baseFilename}`,
      mediumPath: `uploads/medium/${baseFilename}`,
      thumbnailPath: `uploads/thumbnail/${baseFilename}`,
      width: metadata.width,
      height: metadata.height,
      size: metadata.size,
      format: metadata.format,
      mimeType
    };
  } catch (error) {
    console.error(`Error processing image: ${error.message}`);
    throw error;
  }
}

// Fungsi utama
async function standardizeImageFormats() {
  let connection;
  let retries = 3; // Jumlah percobaan koneksi

  try {
    // Pastikan direktori uploads ada
    await ensureDirectoryExists(uploadsDir);
    await ensureDirectoryExists(originalDir);
    await ensureDirectoryExists(mediumDir);
    await ensureDirectoryExists(thumbnailDir);

    // Buat koneksi ke database dengan retry
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

    // Ambil semua post dari database
    console.log('Mengambil data post dari database...');
    const [posts] = await connection.execute('SELECT id, title, image FROM posts WHERE image IS NOT NULL');
    console.log(`Ditemukan ${posts.length} post dengan gambar`);

    // Ambil semua gambar dari database
    console.log('Mengambil data gambar dari database...');
    const [images] = await connection.execute('SELECT id, original_path, medium_path, thumbnail_path FROM images');
    console.log(`Ditemukan ${images.length} gambar di database`);

    // Buat map untuk mempercepat pencarian
    const imageMap = new Map();
    const imageIdSet = new Set(); // Set untuk menyimpan ID gambar

    images.forEach(image => {
      imageMap.set(image.id, image);
      imageIdSet.add(image.id); // Tambahkan ID ke set

      // Juga tambahkan path sebagai key untuk mempermudah pencarian
      if (image.original_path) {
        const filename = path.basename(image.original_path);
        imageMap.set(filename, image);
      }
    });

    // Proses setiap post
    console.log('Memproses post...');
    let standardizedCount = 0;
    let errorCount = 0;

    for (const post of posts) {
      try {
        console.log(`\nMemproses post: ${post.id} - ${post.title}`);
        console.log(`Image: ${post.image}`);

        // Cek format gambar
        let imageId = null;
        let imagePath = null;
        let needsUpdate = false;

        // Cek apakah image adalah UUID
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidPattern.test(post.image)) {
          console.log('Format gambar: UUID');
          imageId = post.image;

          // Cek apakah UUID ada di tabel images
          if (imageIdSet.has(imageId)) {
            console.log('UUID ditemukan di tabel images');
          } else {
            console.log('UUID tidak ditemukan di tabel images, perlu dibuat entri baru');
            needsUpdate = true;
          }
        }
        // Cek apakah image adalah path relatif (image-*)
        else if (post.image.startsWith('image-')) {
          console.log('Format gambar: Path relatif (image-*)');

          // Cek apakah file ada di direktori uploads
          const sourcePath = path.join(uploadsDir, post.image);
          if (await fileExists(sourcePath)) {
            console.log('File ditemukan di direktori uploads');
            imagePath = sourcePath;
            needsUpdate = true;
          } else {
            console.log('File tidak ditemukan di direktori uploads');
            errorCount++;
            continue;
          }
        }
        // Cek apakah image adalah URL lengkap
        else if (post.image.startsWith('http')) {
          console.log('Format gambar: URL lengkap');

          // Ekstrak nama file dari URL
          const urlParts = post.image.split('/');
          const filename = urlParts[urlParts.length - 1];

          // Cek apakah file ada di direktori uploads
          const sourcePath = path.join(uploadsDir, filename);
          if (await fileExists(sourcePath)) {
            console.log('File ditemukan di direktori uploads');
            imagePath = sourcePath;
            needsUpdate = true;
          } else {
            console.log('File tidak ditemukan di direktori uploads');
            errorCount++;
            continue;
          }
        }
        // Format lain
        else {
          console.log('Format gambar tidak dikenali');
          errorCount++;
          continue;
        }

        // Jika perlu update
        if (needsUpdate) {
          // Buat UUID baru jika belum ada
          if (!imageId) {
            imageId = uuidv4();
            console.log(`Membuat UUID baru: ${imageId}`);
          }

          // Jika ada path gambar, proses gambar
          if (imagePath) {
            console.log(`Memproses gambar dari ${imagePath}`);

            // Tentukan MIME type
            let mimeType = 'image/jpeg';
            if (imagePath.endsWith('.png')) {
              mimeType = 'image/png';
            } else if (imagePath.endsWith('.gif')) {
              mimeType = 'image/gif';
            } else if (imagePath.endsWith('.webp')) {
              mimeType = 'image/webp';
            }

            // Proses gambar
            const processedImage = await processImage(imagePath, imageId, mimeType);

            // Simpan metadata ke database
            console.log('Menyimpan metadata ke database');
            await connection.execute(
              `INSERT INTO images (id, original_filename, original_path, thumbnail_path, medium_path, mime_type, size, width, height, post_id, storage_type, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE
               original_path = VALUES(original_path),
               thumbnail_path = VALUES(thumbnail_path),
               medium_path = VALUES(medium_path),
               post_id = VALUES(post_id),
               updated_at = NOW()`,
              [
                processedImage.id,
                path.basename(imagePath),
                processedImage.originalPath,
                processedImage.thumbnailPath,
                processedImage.mediumPath,
                processedImage.mimeType,
                processedImage.size || 0,
                processedImage.width || 0,
                processedImage.height || 0,
                post.id,
                'local'
              ]
            );
          }

          // Update post dengan UUID
          console.log(`Mengupdate post dengan UUID: ${imageId}`);
          await connection.execute(
            'UPDATE posts SET image = ?, updated_at = NOW() WHERE id = ?',
            [imageId, post.id]
          );

          standardizedCount++;
        }
      } catch (error) {
        console.error(`Error memproses post ${post.id}: ${error.message}`);
        errorCount++;
      }
    }

    console.log('\nProses standardisasi selesai');
    console.log(`Total post yang diproses: ${posts.length}`);
    console.log(`Post yang berhasil distandardisasi: ${standardizedCount}`);
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
standardizeImageFormats().catch(console.error);
