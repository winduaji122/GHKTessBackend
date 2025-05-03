// Script untuk menguji koneksi database
require('dotenv').config({ path: '.env.production.local' });
const mysql = require('mysql2/promise');

async function testConnection() {
  console.log('Testing database connection with:');
  console.log({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    // Don't log password
  });

  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    console.log('Connection successful!');
    
    // Test query
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log('Query result:', rows);
    
    // Close connection
    await connection.end();
    console.log('Connection closed.');
    
    return true;
  } catch (error) {
    console.error('Connection failed:', error.message);
    return false;
  }
}

testConnection()
  .then(success => {
    console.log('Test completed with ' + (success ? 'SUCCESS' : 'FAILURE'));
    process.exit(success ? 0 : 1);
  });
