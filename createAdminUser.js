const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { logger } = require('./utils/logger');
const { executeQuery } = require('./config/databaseConfig');

const createAdminUser = async () => {
  const adminId = uuidv4();
  const adminEmail = 'winduaji999@gmail.com';
  const adminPassword = 'dehonian@kse';
  const adminUsername = 'winduaji';
  const adminName = 'Windu Aji';

  try {
    // Cek apakah user sudah ada
    const existingUsers = await executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM users WHERE email = ?', [adminEmail]);
      return rows;
    });

    if (existingUsers.length > 0) {
      logger.info('Admin user sudah ada. Memperbarui data...');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(adminPassword, salt);

      await executeQuery(async (connection) => {
        await connection.query(
          'UPDATE users SET username = ?, password = ?, name = ?, is_admin = 1, role = "admin", is_approved = 1 WHERE email = ?',
          [adminUsername, hashedPassword, adminName, adminEmail]
        );
      });

      logger.info('Admin user berhasil diperbarui');
    } else {
      logger.info('Membuat admin user baru...');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(adminPassword, salt);

      await executeQuery(async (connection) => {
        await connection.query(
          'INSERT INTO users (id, username, email, password, name, is_admin, role, is_approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [adminId, adminUsername, adminEmail, hashedPassword, adminName, 1, 'admin', 1]
        );
      });

      logger.info('Admin user berhasil dibuat dengan ID:', adminId);
    }
  } catch (error) {
    logger.error('Error saat membuat/memperbarui admin user:', error);
  }
};

createAdminUser();