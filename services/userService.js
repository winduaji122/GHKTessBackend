const User = require('../models/User');
const { executeQuery } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');
const { 
  sendVerificationEmail, 
  sendNotificationEmail, 
  sendApprovalNotification, 
  sendRejectionNotification, 
  sendPasswordResetEmail, 
  sendAdminApprovalRequest 
} = require('../utils/emailService');
const { verifyGoogleToken } = require('../config/googleAuth'); 
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/databaseConfig');

class UserService {
  static async createUser(userData) {
    return executeQuery(async () => {
      const user = await User.create(userData);
      const verificationToken = uuidv4();
      await User.setVerificationToken(user.id, verificationToken);
      
      const verificationLink = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;
      await sendVerificationEmail(user.email, verificationLink);
      
      if (user.role === 'writer') {
        await sendAdminApprovalRequest(user.email);
      }

      return user;
    });
  }

  static async verifyEmail(token) {
    return executeQuery(async () => {
      const user = await User.findByVerificationToken(token);
      if (!user) {
        throw new Error('Invalid verification token');
      }
      await User.verifyEmail(user.id);
      await sendNotificationEmail(user.email, 'Your email has been verified successfully.');
      return user;
    });
  }

  static async loginUser(email, password) {
    const user = await User.findByEmail(email);
    if (!user || !(await user.comparePassword(password))) {
      throw new Error('Invalid email or password');
    }
    if (!user.is_verified) {
      throw new Error('Email not verified');
    }
    const token = jwt.sign(
      { id: user.id, role: user.role, is_admin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN }
    );
    const refreshTokenExpiresIn = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN);
    await User.setRefreshToken(user.id, refreshToken, refreshTokenExpiresIn);
    return { user, token, refreshToken };
  }

  static async googleLogin(token) {
    const payload = await verifyGoogleToken(token);
    let user = await User.findByEmail(payload.email);
    if (!user) {
      user = await this.createUser({
        email: payload.email,
        name: payload.name,
        is_verified: true,
        google_id: payload.sub
      });
    }
    const jwtToken = jwt.sign(
      { id: user.id, role: user.role, is_admin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN }
    );
    await User.setRefreshToken(user.id, refreshToken, parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN));
    return { user, token: jwtToken, refreshToken };
  }

  static async logoutUser(userId) {
    await User.removeRefreshToken(userId);
  }


  static async requestPasswordReset(email) {
    const user = await User.findByEmail(email);
    if (!user) {
      throw new Error('User not found');
    }
    const resetToken = uuidv4();
    await User.setResetPasswordToken(user.id, resetToken);
    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    await sendPasswordResetEmail(user.email, resetLink);
  }

  static async resetPassword(token, newPassword) {
    return executeQuery(async () => {
      const user = await User.findByResetPasswordToken(token);
      if (!user) {
        throw new Error('Invalid or expired reset token');
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await User.updatePassword(user.id, hashedPassword);
      await User.clearResetPasswordToken(user.id);
      await sendNotificationEmail(user.email, 'Your password has been reset successfully.');
    });
  }

  static async approveWriter(userId) {
    return executeQuery(async () => {
      const user = await User.findById(userId);
      if (!user || user.role !== 'writer') {
        throw new Error('Invalid user or not a writer');
      }
      await User.approveWriter(userId);
      await sendApprovalNotification(user.email);
    });
  }

  static async rejectWriter(userId) {
    return executeQuery(async () => {
      const user = await User.findById(userId);
      if (!user || user.role !== 'writer') {
        throw new Error('Invalid user or not a writer');
      }
      await User.rejectWriter(userId);
      await sendRejectionNotification(user.email);
    });
  }

  static async updateUserProfile(userId, updateData) {
    return executeQuery(async () => {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      const updatedUser = await User.update(userId, updateData);
      return updatedUser;
    });
  }

  static async getAllUsers() {
    return User.findAll();
  }

  static async getUserById(userId) {
    try {
      const connection = await pool.getConnection();
      const [rows] = await connection.query(
        'SELECT * FROM users WHERE id = ?',
        [userId]
      );
      connection.release();
      
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      logger.error(`Error getting user by ID: ${error.message}`);
      throw error;
    }
  }

  static async deleteUser(userId) {
    try {
      const connection = await pool.getConnection();
      const [result] = await connection.query(
        'DELETE FROM users WHERE id = ?',
        [userId]
      );
      connection.release();
      
      return result.affectedRows > 0;
    } catch (error) {
      logger.error(`Error deleting user: ${error.message}`);
      throw error;
    }
  }

  static async resendVerificationEmail(userId) {
    return executeQuery(async () => {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      if (user.is_verified) {
        throw new Error('User is already verified');
      }
      const verificationToken = uuidv4();
      await User.setVerificationToken(user.id, verificationToken);
      const verificationLink = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;
      await sendVerificationEmail(user.email, verificationLink);
    });
  }

  static async updateUser(id, userData) {
    try {
      const connection = await pool.getConnection();
      
      // Buat query dinamis berdasarkan field yang ada di userData
      const fields = Object.keys(userData);
      const values = Object.values(userData);
      
      if (fields.length === 0) {
        connection.release();
        return false;
      }
      
      const setClause = fields.map(field => `${field} = ?`).join(', ');
      const query = `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = ?`;
      
      const [result] = await connection.query(query, [...values, id]);
      connection.release();
      
      return result.affectedRows > 0;
    } catch (error) {
      logger.error(`Error updating user: ${error.message}`);
      throw error;
    }
  }

  static async getPendingWriters() {
    try {
      const connection = await pool.getConnection();
      const [rows] = await connection.query(
        `SELECT id, username, name, email, role, is_verified, is_approved, created_at, updated_at 
         FROM users 
         WHERE role = 'writer' AND (is_verified = 0 OR is_approved = 0)`
      );
      connection.release();
      
      return rows;
    } catch (error) {
      logger.error(`Error getting pending writers: ${error.message}`);
      throw error;
    }
  }
}

module.exports = UserService;
