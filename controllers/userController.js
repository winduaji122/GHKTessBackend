// backend/controllers/userController.js
const User = require('../models/User');
const { sendApprovalNotification, sendRejectionNotification } = require('../utils/emailService');
const { logger } = require('../utils/logger');
const { executeQuery } = require('../config/databaseConfig');

exports.approveWriter = async (req, res) => {
  return executeQuery(async (connection) => {
    try {
      const { userId } = req.params;
      const [result] = await connection.query('UPDATE users SET role = "writer", is_approved = 1 WHERE id = ?', [userId]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'User tidak ditemukan' });
      }
      const [updatedUser] = await connection.query('SELECT * FROM users WHERE id = ?', [userId]);
      await sendApprovalNotification(updatedUser[0].email);
      res.json({ message: 'Writer berhasil disetujui', user: updatedUser[0] });
    } catch (error) {
      logger.error('Error approving writer:', error);
      res.status(500).json({ message: 'Terjadi kesalahan saat menyetujui writer' });
    }
  });
};

exports.rejectWriter = async (req, res) => {
  return executeQuery(async () => {
    try {
      const { userId } = req.params;
      const updatedUser = await User.rejectWriter(userId);
      if (!updatedUser) {
        return res.status(404).json({ message: 'User tidak ditemukan' });
      }
      await sendRejectionNotification(updatedUser.email);
      res.json({ message: 'Writer berhasil ditolak', user: updatedUser });
    } catch (error) {
      logger.error('Error rejecting writer:', error);
      res.status(500).json({ message: 'Terjadi kesalahan saat menolak writer' });
    }
  });
};