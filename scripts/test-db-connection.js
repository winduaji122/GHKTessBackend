// Script untuk menguji koneksi ke database lokal
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Coba load file .env.production.local
const envPath = path.join(__dirname, '..', '.env.production.local');
if (fs.existsSync(envPath)) {
  console.log('Loading environment from .env.production.local');
  dotenv.config({ path: envPath });
} else {
  console.log('.env.production.local not found, loading default .env');
  dotenv.config();
}

// Konfigurasi database dari environment variables
const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'mydatabase',
  connectTimeout: 10000
};

console.log('Trying to connect to database with config:');
console.log({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  database: dbConfig.database,
  // Don't log password for security reasons
});

async function testConnection() {
  let connection;
  try {
    // Coba buat koneksi
    connection = await mysql.createConnection(dbConfig);
    console.log('Connection successful!');
    
    // Coba jalankan query sederhana
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log('Query result:', rows);
    
    // Coba dapatkan daftar tabel
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('Tables in database:');
    tables.forEach(table => {
      const tableName = Object.values(table)[0];
      console.log(`- ${tableName}`);
    });
    
    console.log('Database connection test completed successfully!');
    return true;
  } catch (error) {
    console.error('Error connecting to database:');
    console.error(error.message);
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('Access denied. Check your username and password.');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('Connection refused. Make sure MySQL is running.');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error(`Database '${dbConfig.database}' does not exist.`);
      console.log('Would you like to create it? (Not implemented in this script)');
    }
    return false;
  } finally {
    if (connection) {
      try {
        await connection.end();
        console.log('Connection closed.');
      } catch (err) {
        console.error('Error closing connection:', err.message);
      }
    }
  }
}

// Jalankan test
testConnection()
  .then(success => {
    if (!success) {
      console.log('\nTroubleshooting tips:');
      console.log('1. Make sure MySQL server is running');
      console.log('2. Check that the username and password are correct');
      console.log('3. Verify that the database exists');
      console.log('4. Ensure that the user has access to the database');
      console.log('5. Check if MySQL is listening on the specified port');
    }
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
