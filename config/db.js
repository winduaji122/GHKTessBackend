// backend/config/db.js
const { pool, executeQuery } = require('./databaseConfig');

// Export pool dan executeQuery untuk digunakan oleh model
module.exports = {
  pool,
  executeQuery,
  query: executeQuery // Alias untuk executeQuery untuk kompatibilitas
};
