// Load environment variables based on NODE_ENV
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables based on NODE_ENV
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.join(__dirname, envFile);

// Check if env file exists
if (fs.existsSync(envPath)) {
  console.log(`Loading environment from ${envFile}`);
  dotenv.config({ path: envPath });
} else {
  console.log(`${envFile} not found, loading default .env`);
  dotenv.config();
}

// Import and start the server
const { startServer } = require('./server');

// Start the server
startServer()
  .then(server => {
    console.log(`Server started in ${NODE_ENV} mode`);
  })
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
