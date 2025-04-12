const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const { executeQuery, createToken, revokeToken } = require('../config/databaseConfig');

class User {
  constructor(userData) {
    Object.assign(this, userData);
  }

  async comparePassword(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
  }

  static async findById(id) {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM users WHERE id = ?', [id]);
      return rows[0] ? new User(rows[0]) : null;
    });
  }

  static async findByEmail(email) {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);
      return rows[0] ? new User(rows[0]) : null;
    });
  }

  static async create(userData) {
    const { username, email, password, name, role = 'writer' } = userData;
    const hashedPassword = await bcrypt.hash(password, 10);
    const isAdmin = role === 'admin' ? 1 : 0;
    const isApproved = role === 'admin' ? 1 : 0;
    const isVerified = 0;
    const verificationToken = crypto.randomBytes(20).toString('hex');
    const id = uuidv4();

    return executeQuery(async (connection) => {
      await connection.query('START TRANSACTION');
      try {
        const [result] = await connection.query(
          'INSERT INTO users (id, username, email, password, name, role, is_approved, is_admin, is_verified, verification_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
          [id, username, email, hashedPassword, name, role, isApproved, isAdmin, isVerified, verificationToken]
        );
        
        await connection.query('COMMIT');
        logger.info(`User created successfully. ID: ${id}, Email: ${email}, Role: ${role}, Is Approved: ${isApproved}, Verification Token: ${verificationToken}`);
        return { id, verificationToken, email, role, isApproved, isVerified };
      } catch (error) {
        await connection.query('ROLLBACK');
        logger.error('Error creating user:', error);
        throw error;
      }
    });
  }

  static async updateRole(id, role) {
    const isAdmin = role === 'admin' ? 1 : 0;
    const isApproved = role === 'writer' ? 0 : 1;
    
    return executeQuery(async (connection) => {
      await connection.query('UPDATE users SET role = ?, is_approved = ?, is_admin = ?, updated_at = NOW() WHERE id = ?', [role, isApproved, isAdmin, id]);
      return this.findById(id);
    });
  }

  static async findPendingWriters() {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM users WHERE role = ? AND is_approved = ?', ['writer', 0]);
      return rows.map(row => new User(row));
    });
  }

  static async findByUsername(username) {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM users WHERE username = ?', [username]);
      return rows[0] ? new User(rows[0]) : null;
    });
  }

  static async updateProfile(userId, updateData) {
    return executeQuery(async (connection) => {
      const [result] = await connection.query(
        'UPDATE users SET name = ?, email = ?, updated_at = NOW() WHERE id = ?',
        [updateData.name, updateData.email, userId]
      );
      
      if (result.affectedRows === 0) {
        throw new Error('User not found');
      }
      
      return this.findById(userId);
    });
  }

  static async findVerifiedUserByToken(token) {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query(
        'SELECT * FROM users WHERE verification_token IS NULL AND is_verified = 1 AND id IN (SELECT id FROM users WHERE verification_token = ? LIMIT 1)',
        [token]
      );
      return rows[0] ? new User(rows[0]) : null;
    });
  }

  static async findByIdAndUpdate(userId, updateData, options = {}) {
    return executeQuery(async (connection) => {
      updateData.updated_at = new Date();
      
      const [result] = await connection.query(
        'UPDATE users SET ? WHERE id = ?',
        [updateData, userId]
      );
      
      if (result.affectedRows === 0) {
        throw new Error('User not found');
      }
      
      if (options.new !== false) {
        return this.findById(userId);
      }
      return null;
    });
  }

  static async getPendingWriters() {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM users WHERE role = ? AND is_approved = ?', ['writer', 0]);
      return rows.map(row => new User(row));
    });
  }

  static async findApprovedWriters() {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM users WHERE role = ? AND is_approved = ?', ['writer', 1]);
      return rows.map(row => new User(row));
    });
  }

  static async approveUser(userId) {
    return executeQuery(async (connection) => {
      logger.info(`Updating user ${userId} approval status in database`);
      const [result] = await connection.query(
        'UPDATE users SET is_approved = 1, role = "writer" WHERE id = ?',
        [userId]
      );
      if (result.affectedRows === 0) {
        logger.warn(`No user found with ID ${userId} for approval`);
        return null;
      }
      logger.info(`User ${userId} updated successfully`);
      return this.findById(userId);
    });
  }

  static async rejectWriter(userId) {
    return executeQuery(async (connection) => {
      const [result] = await connection.query(
        'UPDATE users SET role = ?, is_approved = ?, updated_at = NOW() WHERE id = ? AND role = ?',
        ['user', 0, userId, 'writer']
      );
      
      if (result.affectedRows === 0) {
        throw new Error('User not found or not a writer');
      }
      
      return this.findById(userId);
    });
  }

  static async getStats() {
    return executeQuery(async (connection) => {
      const [totalUsers] = await connection.query('SELECT COUNT(*) as count FROM users');
      const [writerCount] = await connection.query('SELECT COUNT(*) as count FROM users WHERE role = ?', ['writer']);
      const [pendingApprovalCount] = await connection.query('SELECT COUNT(*) as count FROM users WHERE role = ? AND is_approved = ?', ['writer', 0]);
      const [pendingVerificationCount] = await connection.query('SELECT COUNT(*) as count FROM users WHERE is_verified = ?', [0]);

      return {
        totalUsers: totalUsers[0].count,
        writerCount: writerCount[0].count,
        pendingApprovalCount: pendingApprovalCount[0].count,
        pendingVerificationCount: pendingVerificationCount[0].count
      };
    });
  }

  static async findAll() {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM users');
      return rows.map(row => new User(row));
    });
  }

  static async delete(userId) {
    return executeQuery(async (connection) => {
      const [result] = await connection.query('DELETE FROM users WHERE id = ?', [userId]);
      
      if (result.affectedRows === 0) {
        throw new Error('User not found');
      }
      
      return true;
    });
  }

  static findByPk(id) {
    return this.findById(id);
  }


  static async getUserByEmail(email) {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query(
        'SELECT * FROM users WHERE email = ?',
        [email]
      );
      
      return rows.length > 0 ? rows[0] : null;
    });
  }

  static async getUserById(id) {
    return executeQuery(async (connection) => {
      const [rows] = await connection.query(
        'SELECT * FROM users WHERE id = ?',
        [id]
      );
      
      return rows.length > 0 ? rows[0] : null;
    });
  }
}

module.exports = User;
