// Vercel build script
const fs = require('fs');
const path = require('path');

console.log('Running Vercel build script...');

// Ensure the uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  console.log('Creating uploads directory...');
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Ensure the profiles directory exists
const profilesDir = path.join(uploadsDir, 'profiles');
if (!fs.existsSync(profilesDir)) {
  console.log('Creating profiles directory...');
  fs.mkdirSync(profilesDir, { recursive: true });
}

// Create a test file to verify write permissions
const testFile = path.join(uploadsDir, 'test-build.txt');
try {
  fs.writeFileSync(testFile, 'Build test file - ' + new Date().toISOString());
  console.log('Successfully wrote test file');
} catch (error) {
  console.error('Error writing test file:', error);
}

console.log('Vercel build completed successfully');
