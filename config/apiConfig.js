// Konfigurasi API
const apiConfig = {
  // Base URL untuk API
  baseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
  
  // Versi API
  version: 'v1',
  
  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 100 // limit setiap IP ke 100 request per windowMs
  },
  
  // CORS settings
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  },
  
  // JWT settings
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: '24h'
  },
  
  // File upload settings
  upload: {
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif'],
    uploadDir: 'uploads'
  }
};

module.exports = apiConfig; 