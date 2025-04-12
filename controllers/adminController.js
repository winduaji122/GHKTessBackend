const User = require('../models/User');
const { sendApprovalNotification, sendVerificationEmail, sendRejectionNotification } = require('../utils/emailService');
const { logger } = require('../utils/logger');
const { getTokenStats } = require('../utils/tokenCleanup');

exports.approveUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const updatedUser = await User.approveUser(userId);
    if (!updatedUser) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }
    await sendApprovalNotification(updatedUser.email);
    res.json({ message: 'User berhasil disetujui', user: updatedUser });
  } catch (error) {
    logger.error('Error approving user:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat menyetujui user' });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll();
    logger.info('Users fetched:', users); // Tambahkan log ini di backend
    res.json(users);
  } catch (error) {
    logger.error('Error getting all users:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil data pengguna' });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!['admin', 'writer', 'user', 'pending'].includes(role)) {
      return res.status(400).json({ message: 'Peran tidak valid' });
    }

    const updatedUser = await User.updateRole(userId, role);

    if (!updatedUser) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
    }

    if (role === 'pending') {
      await sendVerificationEmail(updatedUser);
    } else if (role === 'writer' && !updatedUser.is_approved) {
      // Jika diubah menjadi writer dan belum disetujui, kirim email persetujuan
      await sendApprovalNotification(updatedUser);
    } else if (role === 'user' && updatedUser.role === 'writer') {
      await sendRejectionNotification(updatedUser.email);
    }

    logger.info(`User role updated: ${updatedUser.email} to ${role}`);
    res.json({
      message: 'Peran pengguna berhasil diperbarui',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        is_approved: updatedUser.is_approved
      }
    });
  } catch (error) {
    logger.error('Error in updateUserRole:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat memperbarui peran pengguna' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    await User.delete(userId);
    logger.info(`User deleted: ${userId}`);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    logger.error('Error deleting user:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Tambahkan fungsi createWriter
exports.createWriter = async (req, res) => {
  try {
    const { username, email, password, name } = req.body;
    const newWriter = await User.create({
      username,
      email,
      password,
      name,
      role: 'writer',
      is_approved: 1, // Langsung disetujui karena dibuat oleh admin
      is_verified: 1, // Langsung diverifikasi karena dibuat oleh admin
      created_at: new Date(),
      updated_at: new Date()
    });

    logger.info(`New writer created by admin: ${newWriter.email}`);
    res.status(201).json({
      message: 'Penulis baru berhasil dibuat',
      writer: {
        id: newWriter.id,
        username: newWriter.username,
        email: newWriter.email,
        name: newWriter.name,
        role: newWriter.role
      }
    });
  } catch (error) {
    logger.error('Error creating new writer:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat membuat penulis baru' });
  }
};

// Perbarui fungsi getUserStats untuk menggunakan properti yang benar
exports.getUserStats = async (req, res) => {
  try {
    const totalUsers = await User.findAll();
    const writerCount = totalUsers.filter(user => user.role === 'writer').length;
    const pendingApprovalCount = totalUsers.filter(user => user.role === 'writer' && user.is_approved === 0).length;
    const pendingVerificationCount = totalUsers.filter(user => user.is_verified === 0).length;

    logger.info('Admin stats retrieved');
    res.json({
      message: 'Statistik Admin',
      stats: {
        totalUsers: totalUsers.length,
        writerCount,
        pendingApprovalCount,
        pendingVerificationCount
      }
    });
  } catch (error) {
    logger.error('Error in getUserStats:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil statistik admin' });
  }
};

exports.getApprovedWriters = async (req, res) => {
  try {
    const approvedWriters = await User.findApprovedWriters();
    res.json(approvedWriters);
  } catch (error) {
    logger.error('Error getting approved writers:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil daftar penulis yang disetujui' });
  }
};

// Perbarui fungsi adminDashboard
exports.adminDashboard = async (req, res) => {
  try {
    const stats = await User.getStats(); // Asumsikan kita memiliki metode getStats di model User
    const pendingWriters = await User.findPendingWriters();
    res.json({ 
      message: 'Admin Dashboard',
      stats,
      pendingWriters
    });
  } catch (error) {
    logger.error('Error in adminDashboard:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengakses dashboard admin' });
  }
};

exports.rejectWriter = async (req, res) => {
  try {
    const { userId } = req.params;
    await User.rejectWriter(userId);
    res.json({ message: 'Penulis berhasil ditolak' });
  } catch (error) {
    logger.error('Error rejecting writer:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat menolak penulis' });
  }
};

exports.getPendingWriters = async (req, res) => {
  try {
    const pendingWriters = await User.findAll({
      where: {
        role: 'writer',
        is_approved: false
      },
      attributes: ['id', 'name', 'email', 'created_at', 'is_approved', 'is_verified']
    });
    res.json(pendingWriters);
  } catch (error) {
    logger.error('Error fetching pending writers:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil data penulis pending' });
  }
};

exports.approveWriter = async (req, res) => {
  try {
    const { userId } = req.params;
    const updatedWriter = await User.approveUser(userId);
    
    if (!updatedWriter) {
      return res.status(404).json({ message: 'Penulis tidak ditemukan' });
    }

    await sendApprovalNotification(updatedWriter.email);

    res.status(200).json({ message: 'Penulis berhasil disetujui dan email notifikasi telah dikirim' });
  } catch (error) {
    logger.error('Error in approveWriter:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat menyetujui penulis' });
  }
};

exports.getDashboardStats = async (req, res) => {
  try {
    // Dapatkan statistik token
    const tokenStats = await getTokenStats();
    
    // ... kode lainnya untuk dashboard ...
    
    return res.status(200).json({
      success: true,
      stats: {
        tokens: tokenStats,
        // ... statistik lainnya ...
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil statistik'
    });
  }
};
