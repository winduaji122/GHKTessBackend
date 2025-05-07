/**
 * Script untuk membuat tabel images di database
 *
 * Cara penggunaan:
 * node createImagesTable.js
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Nonaktifkan Redis
process.env.REDIS_ENABLED = 'false';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';

// Konfigurasi database Railway
const dbConfig = {
  host: 'hopper.proxy.rlwy.net',
  port: 59942,
  user: 'root',
  password: 'MOOANaYOrdGrDIRNsFCfjXlsierCZXdX',
  database: 'mydatabase',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: false
  }
};

async function createImagesTable() {
  let connection;
  try {
    console.log('Menghubungkan ke database...');

    // Buat koneksi ke database
    connection = await mysql.createConnection(dbConfig);
    console.log('Berhasil terhubung ke database.');

    // Periksa apakah tabel images sudah ada
    const [tables] = await connection.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = 'images'",
      [dbConfig.database]
    );

    if (tables.length > 0) {
      console.log('Tabel images sudah ada. Tidak perlu dibuat lagi.');
      return;
    }

    // Baca file SQL untuk membuat tabel
    const sqlFilePath = path.join(__dirname, '..', 'database', 'schema', 'images.sql');
    let sql;

    try {
      sql = fs.readFileSync(sqlFilePath, 'utf8');
    } catch (error) {
      console.error('Error membaca file SQL:', error.message);

      // Jika file tidak ditemukan, gunakan SQL default
      sql = `
        CREATE TABLE IF NOT EXISTS \`images\` (
          \`id\` VARCHAR(36) NOT NULL,
          \`original_filename\` VARCHAR(255) NOT NULL,
          \`original_path\` VARCHAR(255) NOT NULL,
          \`thumbnail_path\` VARCHAR(255) NOT NULL,
          \`medium_path\` VARCHAR(255) NOT NULL,
          \`mime_type\` VARCHAR(50) NOT NULL,
          \`size\` INT NOT NULL,
          \`width\` INT NOT NULL,
          \`height\` INT NOT NULL,
          \`user_id\` VARCHAR(36) NULL,
          \`post_id\` VARCHAR(36) NULL,
          \`storage_type\` ENUM('local', 's3') NOT NULL DEFAULT 'local',
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_images_user_id\` (\`user_id\`),
          INDEX \`idx_images_post_id\` (\`post_id\`),
          INDEX \`idx_images_created_at\` (\`created_at\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `;
    }

    // Jalankan SQL untuk membuat tabel
    console.log('Membuat tabel images...');
    await connection.query(sql);

    console.log('Tabel images berhasil dibuat!');

    // Periksa apakah tabel berhasil dibuat
    const [tablesAfter] = await connection.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = 'images'",
      [dbConfig.database]
    );

    if (tablesAfter.length > 0) {
      console.log('Verifikasi: Tabel images berhasil dibuat.');

      // Tampilkan struktur tabel
      const [columns] = await connection.query(
        "SELECT column_name, column_type, is_nullable, column_key, column_default FROM information_schema.columns WHERE table_schema = ? AND table_name = 'images' ORDER BY ordinal_position",
        [dbConfig.database]
      );

      console.log('\nStruktur tabel images:');
      console.log('------------------------');
      columns.forEach(column => {
        console.log(`${column.column_name} (${column.column_type}) ${column.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${column.column_key === 'PRI' ? 'PRIMARY KEY' : ''} ${column.column_default ? `DEFAULT ${column.column_default}` : ''}`);
      });
    } else {
      console.error('Error: Tabel images gagal dibuat.');
    }

  } catch (error) {
    console.error('Error membuat tabel images:', error);
  } finally {
    if (connection) {
      try {
        await connection.end();
        console.log('\nKoneksi database ditutup.');
      } catch (err) {
        console.error('Error menutup koneksi database:', err);
      }
    }
  }
}

// Jalankan fungsi untuk membuat tabel
createImagesTable()
  .then(() => {
    console.log('\nScript selesai.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error menjalankan script:', error);
    process.exit(1);
  });
