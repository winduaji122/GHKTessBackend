/**
 * Script untuk membuat direktori yang diperlukan saat deployment
 * Jalankan dengan: node scripts/setup-directories.js
 */

const fs = require('fs');
const path = require('path');

// Direktori yang perlu dibuat
const directories = [
  'uploads',
  'uploads/original',
  'uploads/medium',
  'uploads/thumbnail',
  'uploads/temp',
  'uploads/profiles',
  'uploads/carousel'
];

// Fungsi untuk membuat direktori
function createDirectory(dir) {
  const fullPath = path.join(__dirname, '..', dir);
  
  try {
    // Cek apakah direktori sudah ada
    if (fs.existsSync(fullPath)) {
      console.log(`Directory already exists: ${fullPath}`);
      return true;
    }
    
    // Buat direktori
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`Directory created: ${fullPath}`);
    
    // Cek apakah direktori berhasil dibuat
    if (fs.existsSync(fullPath)) {
      // Coba tulis file test untuk memastikan direktori dapat ditulis
      const testFile = path.join(fullPath, '.test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      console.log(`Directory is writable: ${fullPath}`);
      return true;
    } else {
      console.error(`Failed to create directory: ${fullPath}`);
      return false;
    }
  } catch (error) {
    console.error(`Error creating directory ${fullPath}:`, error);
    return false;
  }
}

// Buat semua direktori
console.log('Creating required directories...');
let success = true;

for (const dir of directories) {
  if (!createDirectory(dir)) {
    success = false;
  }
}

if (success) {
  console.log('All directories created successfully!');
} else {
  console.error('Some directories could not be created. Check permissions and try again.');
  process.exit(1);
}
