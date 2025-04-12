const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendVerificationEmail, sendAdminApprovalRequest, sendApprovalNotification, sendNotificationEmail, sendTokenRefreshNotification, sendPasswordResetEmail } = require('../utils/emailService');
const { verifyGoogleToken } = require('../config/googleAuth');
const { logger } = require('../utils/logger');
const crypto = require('crypto');
const isProduction = process.env.NODE_ENV === 'production';
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
const { executeQuery } = require('../config/databaseConfig');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('redis');

// Inisialisasi Redis
const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});

// Koneksi sync
(async () => {
  await redisClient.connect();
})();

// Konstanta untuk pesan error
const ERROR_MESSAGES = {
  EMAIL_ALREADY_REGISTERED: 'Email sudah terdaftar',
  INVALID_CREDENTIALS: 'Email atau password salah',
  EMAIL_NOT_VERIFIED: 'Silakan verifikasi email Anda terlebih dahulu',
  WRITER_NOT_APPROVED: 'Akun writer Anda belum disetujui oleh admin',
  SERVER_ERROR: 'Terjadi kesalahan server internal',
  USER_NOT_FOUND: 'Pengguna tidak ditemukan',
  INVALID_TOKEN: 'Token tidak valid atau sudah kadaluarsa',
};

// Tambahkan di awal file
const TOKEN_CONFIG = {
  ACCESS: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshThreshold: 2 * 60,
  },
  REFRESH: {
    secret: process.env.JWT_REFRESH_SECRET,
    expiresIn: parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN) || 365 * 24 * 60 * 60,
    rotateThreshold: 24 * 60 * 60,
  }
};

const COOKIE_CONFIG = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
  domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : 'localhost',
  maxAge: parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN) * 1000 || 365 * 24 * 60 * 60 * 1000
};

// Di bagian atas file, tambahkan Map untuk lock
const refreshTokenLocks = new Map();
const LOCK_TIMEOUT = 10000; // 10 detik timeout untuk lock

// 1. DEFINISIKAN SEMUA HELPER FUNCTIONS DI AWAL FILE
const findTokenByRefreshToken = async (refreshToken) => {
  try {
    const tokens = await executeQuery(
      `SELECT * FROM user_tokens
      WHERE token = ?
        AND type = 'refresh'
        AND is_revoked = 0
        AND expires_at > NOW()`,
      [refreshToken]
    );
    return tokens.length > 0 ? tokens[0] : null;
  } catch (error) {
    console.error('Error finding token:', error);
    return null;
  }
};

const getUserById = async (userId) => {
  try {
    const users = await executeQuery(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    return users.length > 0 ? users[0] : null;
  } catch (error) {
    console.error('Error finding user:', error);
    return null;
  }
};

const revokeToken = async (token) => {
  try {
    await executeQuery(
      `UPDATE user_tokens
      SET is_revoked = 1
      WHERE token = ?`,
      [token]
    );
    return true;
  } catch (error) {
    console.error('Error revoking token:', error);
    return false;
  }
};

const createToken = async (userId, token, type, userAgent, ipAddress) => {
  try {
    const expiresAt = new Date();
    if (type === 'refresh') {
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 hari
    } else {
      expiresAt.setHours(expiresAt.getHours() + 1); // 1 jam
    }

    await executeQuery(
      `INSERT INTO user_tokens
      (id, user_id, token, type, expires_at, user_agent, ip_address)
      VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
      [userId, token, type, expiresAt, userAgent, ipAddress]
    );
    return true;
  } catch (error) {
    console.error('Error creating token:', error);
    return false;
  }
};

// Fungsi untuk menghapus semua token user (revoke)
const revokeAllUserTokens = async (userId) => {
  return executeQuery(async (connection) => {
    const [result] = await connection.query(
      'UPDATE user_tokens SET is_revoked = 1 WHERE user_id = ?',
      [userId]
    );

    return result.affectedRows;
  });
};

// Fungsi untuk update last_used_at token
const updateTokenLastUsed = async (tokenId) => {
  return executeQuery(async (connection) => {
    await connection.query(
      'UPDATE user_tokens SET last_used_at = NOW() WHERE id = ?',
      [tokenId]
    );
  });
};

// Tambahkan fungsi generateAccessToken jika belum ada
const generateAccessToken = (userData) => {
  return jwt.sign(
    {
      id: userData.id,
      role: userData.role
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

// Tambahkan fungsi handleTokenRefresh jika belum ada
const handleTokenRefresh = async (refreshToken) => {
  // Fungsi ini menangani proses refresh token
  // dan mengembalikan token baru
  try {
    // Dapatkan data token dari database
    const [tokenRecord] = await executeQuery(async (connection) => {
      return connection.query(
        `SELECT
          ut.token,
          ut.user_id,
          u.role,
          ut.expires_at
        FROM user_tokens ut
        JOIN users u ON ut.user_id = u.id
        WHERE
          ut.token = ? AND
          ut.expires_at > NOW() AND
          ut.is_revoked = 0 AND
          ut.type = 'refresh'`,
        [refreshToken]
      );
    });

    if (!tokenRecord || tokenRecord.length === 0) {
      throw new Error('Token tidak valid atau sudah kadaluarsa');
    }

    const userData = {
      id: tokenRecord[0].user_id,
      role: tokenRecord[0].role
    };

    // Generate token baru
    const accessToken = generateAccessToken(userData);
    const newRefreshToken = uuidv4();

    // Update database
    await executeQuery(async (connection) => {
      await connection.query('CALL InsertRefreshToken(?, ?, ?)', [
        userData.id,
        newRefreshToken,
        null // Gunakan default expiry (1 tahun)
      ]);
    });

    return { accessToken, refreshToken: newRefreshToken, userData };
  } catch (error) {
    logger.error('Error handling token refresh:', error);
    throw error;
  }
};

// Fungsi untuk set cookie
const setTokenCookie = (res, token) => {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 hari
    path: '/'
  };

  res.cookie('refreshToken', token, cookieOptions);
};

// Fungsi untuk generate tokens
const generateTokens = async (user) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = crypto.randomBytes(40).toString('hex');

  return { accessToken, refreshToken };
};

// 2. KEMUDIAN DEFINISIKAN CONTROLLER FUNCTIONS
exports.register = async (req, res) => {
  const startTime = Date.now();
  logger.info('Registration process started');
  try {
    const { username, email, password, name, role } = req.body;
    if (!username || !email || !password || !name || !role) {
      return res.status(400).json({ message: 'Semua field harus diisi' });
    }
    logger.info(`Registration attempt for email: ${email}, username: ${username}, role: ${role}`);

    // Cek email
    const userByEmail = await executeQuery(async (connection) => {
      return await User.findByEmail(email, connection);
    });
    if (userByEmail) {
      logger.warn(`Registration attempt with existing email: ${email}`);
      return res.status(400).json({ message: 'Email sudah terdaftar' });
    }

    // Cek username
    const userByUsername = await executeQuery(async (connection) => {
      return await User.findByUsername(username, connection);
    });
    if (userByUsername) {
      logger.warn(`Registration attempt with existing username: ${username}`);
      return res.status(400).json({ message: 'Username sudah digunakan' });
    }

    // Lanjutkan dengan pembuatan user jika email dan username unik
    const createUserStartTime = Date.now();
    const newUser = await executeQuery(async (connection) => {
      return await User.create({
        username,
        email,
        password,
        name,
        role: role || 'pending',
        is_approved: false,
        is_verified: false
      }, connection);
    });
    logger.info(`User creation completed in ${Date.now() - createUserStartTime}ms`);

    const verificationLink = `${process.env.FRONTEND_URL}/verify/${newUser.verificationToken}`;
    logger.info(`Verification link generated: ${verificationLink}`);

    const sendEmailStartTime = Date.now();
    await sendVerificationEmail(newUser.email, verificationLink);
    logger.info(`Verification email sent in ${Date.now() - sendEmailStartTime}ms`);

    await sendAdminApprovalRequest(newUser.email);
    res.status(201).json({ message: 'Pendaftaran berhasil. Akun Anda sedang menunggu persetujuan admin.' });
  } catch (error) {
    logger.error(`Registration error: ${error.message}`, { error });
    logger.error(`Stack trace: ${error.stack}`);
    res.status(500).json({ message: 'Terjadi kesalahan saat registrasi', error: error.message });
  } finally {
    logger.info(`Total registration process completed in ${Date.now() - startTime}ms`);
  }
};

exports.verifyEmail = async (req, res) => {
  logger.info("Verifying email with token:", req.params.token);
  try {
    const { token } = req.params;
    logger.info("Looking for user with token:", token);
    const user = await User.verifyEmail(token);

    if (!user) {
      logger.info("No user found with token:", token);
      // Cek apakah ada user yang sudah terverifikasi dengan email ini
      const verifiedUser = await User.findVerifiedUserByToken(token);
      if (verifiedUser) {
        return res.status(200).json({ message: 'Email sudah diverifikasi sebelumnya' });
      }
      return res.status(400).json({ message: 'Token verifikasi tidak valid atau sudah kadaluarsa' });
    }

    await sendNotificationEmail(user.email, 'Akun Anda telah diverifikasi');
    logger.info(`User verified: ${user.email}`);
    res.json({ message: 'Email berhasil diverifikasi' });
  } catch (error) {
    logger.error(`Verification error: ${error.message}`, { error });
    res.status(500).json({ message: 'Terjadi kesalahan saat verifikasi email' });
  }
};

exports.approveUser = async (req, res) => {
  try {
    const { userId } = req.params;
    logger.info(`Attempting to approve user with ID: ${userId}`);

    const updatedUser = await User.approveUser(userId);
    if (!updatedUser) {
      logger.warn(`User with ID ${userId} not found for approval`);
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    logger.info(`User ${userId} approved successfully`);
    res.json({ message: 'User berhasil disetujui', user: updatedUser });
  } catch (error) {
    logger.error('Error in approveUser:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat menyetujui user' });
  }
};

exports.approveWriter = async (req, res) => {
  try {
    const { writerId } = req.params;
    const writer = await executeQuery(async (connection) => {
      return await User.findByPk(writerId, connection);
    });

    if (!writer) {
      return res.status(404).json({ message: 'Penulis tidak ditemukan' });
    }

     // Update status penulis
     await executeQuery(async (connection) => {
      await User.update(writerId, {
        is_verified: true,
        is_approved: true,
        role: 'writer'
      }, connection);
    });

    // Kirim email notifikasi
    await sendApprovalNotification(writer.email);

    res.status(200).json({ message: 'Penulis berhasil disetujui dan email notifikasi telah dikirim' });
  } catch (error) {
    logger.error('Error in approveWriter:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat menyetujui penulis' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password, remember_me } = req.body;
    const rememberMe = remember_me === true;

    logger.info(`Login attempt for ${email}, remember me: ${rememberMe}`);

    // Validasi input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email dan password diperlukan'
      });
    }

    // Cari user berdasarkan email
    const user = await User.findByEmail(email);

    if (!user) {
      logger.warn(`Login failed: User not found for email ${email}`);
      return res.status(401).json({
        success: false,
        message: ERROR_MESSAGES.INVALID_CREDENTIALS
      });
    }

    // Verifikasi password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      logger.warn(`Login failed: Invalid password for user ${email}`);
      return res.status(401).json({
        success: false,
        message: ERROR_MESSAGES.INVALID_CREDENTIALS
      });
    }

    // Cek apakah email sudah diverifikasi
    if (!user.email_verified_at && process.env.REQUIRE_EMAIL_VERIFICATION === 'true') {
      logger.warn(`Login failed: Email not verified for user ${email}`);
      return res.status(401).json({
        success: false,
        message: ERROR_MESSAGES.EMAIL_NOT_VERIFIED
      });
    }

    // Cek apakah writer sudah diapprove
    if (user.role === 'writer' && !user.is_approved && process.env.REQUIRE_WRITER_APPROVAL === 'true') {
      logger.warn(`Login failed: Writer not approved for user ${email}`);
      return res.status(401).json({
        success: false,
        message: ERROR_MESSAGES.WRITER_NOT_APPROVED
      });
    }

    // Generate token
    const accessToken = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Generate refresh token dengan durasi yang lebih panjang jika "Ingat Saya" dicentang
    const refreshTokenDuration = rememberMe
      ? TOKEN_CONFIG.REFRESH.expiresIn
      : Math.min(TOKEN_CONFIG.REFRESH.expiresIn, 7 * 24 * 60 * 60); // 7 hari jika tidak ingat saya

    // Hapus token refresh yang sudah ada untuk user ini
    try {
      await executeQuery(
        `UPDATE user_tokens
        SET is_revoked = 1
        WHERE user_id = ? AND type = 'refresh' AND is_revoked = 0`,
        [user.id]
      );
      logger.info(`Revoked existing refresh tokens for user ${user.id}`);
    } catch (revokeError) {
      logger.error(`Error revoking existing tokens: ${revokeError.message}`);
      // Lanjutkan proses meskipun ada error
    }

    // Generate refresh token baru
    const refreshToken = uuidv4();

    // Simpan refresh token
    try {
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + refreshTokenDuration);

      await executeQuery(
        `INSERT INTO user_tokens
        (id, user_id, token, type, expires_at, user_agent, ip_address)
        VALUES (UUID(), ?, ?, 'refresh', ?, ?, ?)`,
        [user.id, refreshToken, expiresAt, req.headers['user-agent'] || 'unknown', req.ip || 'unknown']
      );

      logger.info(`Created new refresh token for user ${user.id}, expires at ${expiresAt.toISOString()}`);
    } catch (tokenError) {
      logger.error(`Error creating refresh token: ${tokenError.message}`);
      // Jika gagal membuat token, tetap lanjutkan dengan access token saja
    }

    // Set cookie dengan durasi yang sesuai
    const cookieMaxAge = rememberMe
      ? COOKIE_CONFIG.maxAge
      : Math.min(COOKIE_CONFIG.maxAge, 7 * 24 * 60 * 60 * 1000); // 7 hari jika tidak ingat saya

    res.cookie('refreshToken', refreshToken, {
      ...COOKIE_CONFIG,
      maxAge: cookieMaxAge
    });

    // Hapus update last login karena kolom tidak ditemukan di database
    // Ini tidak kritis untuk fungsi login

    logger.info(`Login successful for user ${email} (${user.id}), remember me: ${rememberMe}`);
    logger.info(`Token akan kedaluwarsa dalam ${rememberMe ? 'durasi panjang' : 'durasi pendek'}`);

    // Kirim response
    return res.status(200).json({
      success: true,
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_admin: user.is_admin === 1
      },
      rememberMe // Kirim kembali preferensi "Ingat Saya" ke client
    });

  } catch (error) {
    logger.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR
    });
  }
};

exports.googleLogin = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Token Google tidak ditemukan' });
    }

    // Verifikasi token Google
    const payload = await verifyGoogleToken(token);

    // Cari user berdasarkan email
    let user = await User.findByEmail(payload.email);

    if (!user) {
      // Buat user baru jika belum terdaftar
      const randomPassword = crypto.randomBytes(20).toString('hex');

      user = await User.create({
        username: payload.email.split('@')[0],
        email: payload.email,
        name: payload.name,
        password: randomPassword,
        profile_picture: payload.picture,
        is_verified: true, // User Google sudah terverifikasi
        is_approved: false, // Tetap perlu persetujuan admin jika writer
        role: 'user' // Default role
      });

      // Jika mendaftar sebagai writer, kirim notifikasi ke admin
      if (req.body.role === 'writer') {
        user.role = 'pending';
        await User.update(user.id, { role: 'pending' });
        await sendAdminApprovalRequest(user.email);

        return res.status(200).json({
          message: 'Registrasi berhasil. Akun Anda sedang menunggu persetujuan admin.',
          requiresApproval: true
        });
      }
    }

    // Proses login untuk user yang sudah ada
    if (user.role === 'pending') {
      return res.status(403).json({
        message: 'Akun Anda sedang menunggu persetujuan admin.',
        requiresApproval: true
      });
    }

    // Generate token
    const accessToken = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const refreshToken = uuidv4();

    // Simpan refresh token
    await User.saveRefreshToken(
      user.id,
      refreshToken,
      new Date(Date.now() + TOKEN_CONFIG.REFRESH.expiresIn * 1000)
    );

    // Set cookie
    res.cookie('refreshToken', refreshToken, COOKIE_CONFIG);

    // Kirim response
    res.status(200).json({
      success: true,
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    logger.error('Error dalam Google login:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat login dengan Google' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await executeQuery(async (connection) => {
      return await User.findById(req.user.id, connection);
    });
    if (!user) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
    }
    if (user.role === 'writer' && !user.is_approved) {
      return res.status(403).json({ message: 'Akun writer Anda belum disetujui oleh admin' });
    }
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      isAdmin: user.is_admin,
      isApproved: user.is_approved
    });
  } catch (error) {
    logger.error('Error in getMe:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil data pengguna' });
  }
};

exports.getPendingWriters = async (req, res) => {
  try {
    const pendingWriters = await executeQuery(async (connection) => {
      return await User.findAll({
        where: {
          role: 'writer',
          is_verified: false
        },
        attributes: ['id', 'name', 'email', 'created_at', 'is_approved', 'is_verified']
      }, connection);
    });
    res.json(pendingWriters);
  } catch (error) {
    logger.error('Error fetching pending writers:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil data penulis pending' });
  }
};

exports.verifyWriter = async (req, res) => {
  try {
    const { writerId } = req.params;
    const writer = await User.findById(writerId);

    if (!writer) {
      return res.status(404).json({ message: 'Penulis tidak ditemukan' });
    }

    if (writer.is_verified) {
      return res.status(400).json({ message: 'Penulis sudah diverifikasi' });
    }

    writer.is_verified = true;
    await writer.save();

    res.status(200).json({ message: 'Penulis berhasil diverifikasi' });
  } catch (error) {
    logger.error('Error in verifyWriter:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat memverifikasi penulis' });
  }
};

// Fungsi untuk membersihkan expired tokens
const cleanExpiredTokens = async (connection) => {
  try {
    const [result] = await connection.query(
      'DELETE FROM user_tokens WHERE expires_at < NOW()'
    );
    if (result.affectedRows > 0) {
      logger.info(`${result.affectedRows} expired tokens dibersihkan pada ${new Date().toISOString()}`);
    }
  } catch (error) {
    logger.error('Error membersihkan expired tokens:', error);
  }
};

exports.logout = async (req, res) => {
  try {
    // Ambil refresh token dari cookie
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      // Cari token di database
      const tokenData = await findTokenByRefreshToken(refreshToken);

      if (tokenData) {
        // Revoke token
        await revokeToken(tokenData.id);
      }
    }

    // Hapus cookie
    res.clearCookie('refreshToken');

    return res.status(200).json({
      success: true,
      message: 'Logout berhasil'
    });
  } catch (error) {
    logger.error('Error dalam logout:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    // Di awal fungsi
    console.log('=== REFRESH TOKEN REQUEST ===');
    console.log('IP:', req.ip);
    console.log('User Agent:', req.headers['user-agent']);
    console.log('Cookies:', req.cookies);

    // Ambil refresh token dari cookie
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      console.log('Refresh token tidak ditemukan dalam cookie');
      return res.status(401).json({
        success: false,
        message: 'Refresh token tidak ditemukan'
      });
    }

    // Cari token di database dengan satu metode konsisten
    const tokenData = await findTokenByRefreshToken(refreshToken);

    if (!tokenData) {
      // Hapus cookie jika token tidak valid
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      });

      return res.status(401).json({
        success: false,
        message: 'Refresh token tidak valid'
      });
    }

    // Tambahkan validasi expiry date
    const now = new Date();
    if (new Date(tokenData.expires_at) < now) {
      console.log('Refresh token sudah expired:', tokenData.expires_at);
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      });

      return res.status(401).json({
        success: false,
        message: 'Refresh token sudah expired'
      });
    }

    // Setelah validasi expiry date
    if (tokenData.is_revoked) {
      console.log('Refresh token sudah di-revoke');
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      });

      return res.status(401).json({
        success: false,
        message: 'Refresh token sudah tidak valid'
      });
    }

    // Ambil data user
    const user = await getUserById(tokenData.user_id);

    if (!user) {
      // Hapus cookie jika user tidak ditemukan
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      });

      return res.status(401).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    // Hapus token lama
    await revokeToken(refreshToken);

    // Generate token baru
    const newRefreshToken = crypto.randomBytes(40).toString('hex');

    // Tambahkan expiry date yang jelas
    const accessTokenExpiry = '1h';
    const refreshTokenExpiry = 30 * 24 * 60 * 60 * 1000; // 30 hari dalam ms

    // Buat access token dengan informasi yang lebih lengkap
    const accessToken = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        // Tambahkan data tambahan yang diperlukan
        is_admin: user.role === 'admin',
        is_verified: user.is_verified === 1
      },
      process.env.JWT_SECRET,
      {
        expiresIn: accessTokenExpiry,
        issuer: 'your-app-name',
        audience: 'your-app-users'
      }
    );

    // Simpan token baru dengan satu metode konsisten
    await createToken(
      user.id,
      newRefreshToken,
      'refresh',
      req.headers['user-agent'] || 'unknown',
      req.ip
    );

    // Set cookie dengan konfigurasi konsisten
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 hari
      path: '/'
    };

    res.cookie('refreshToken', newRefreshToken, cookieOptions);

    // Log untuk debugging
    console.log('=== REFRESH TOKEN SUCCESS ===');
    console.log('User ID:', user.id);
    console.log('New Access Token:', accessToken.substring(0, 15) + '...');
    console.log('New Refresh Token:', newRefreshToken.substring(0, 10) + '...');

    return res.status(200).json({
      success: true,
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('=== REFRESH TOKEN ERROR ===');
    console.error('Error type:', error.name);
    console.error('Error message:', error.message);
    console.error('Stack trace:', error.stack);

    // Kategorikan error untuk response yang lebih informatif
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token tidak valid',
        error: 'invalid_token'
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token sudah expired',
        error: 'token_expired'
      });
    } else if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({
        success: false,
        message: 'Database error',
        error: 'database_error'
      });
    }

    // Default error response
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: 'server_error'
    });
  }
};

exports.updateProfile = async (req, res) => {
  console.log('Update profile request:', { body: req.body, file: req.file });
  try {
    const { name, email } = req.body;
    const userId = req.user.id;
    const profileImage = req.file;

    // Prepare update data
    const updateData = { name, email };

    // If profile image is uploaded, add it to update data
    if (profileImage) {
      console.log('Profile image uploaded:', profileImage.filename);
      updateData.profile_picture = profileImage.filename;
    }

    // Update user in database
    const updatedUser = await executeQuery(async (connection) => {
      return await User.findByIdAndUpdate(
        userId,
        updateData,
        { new: true },
        connection
      );
    });

    if (!updatedUser) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
    }

    res.json({
      success: true,
      message: 'Profil berhasil diperbarui',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        profile_picture: updatedUser.profile_picture,
        role: updatedUser.role
      }
    });
  } catch (error) {
    logger.error('Error in updateProfile:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memperbarui profil'
    });
  }
};

exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await executeQuery(async (connection) => {
      return await User.findById(userId, connection);
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profile_picture: user.profile_picture,
        role: user.role,
        created_at: user.created_at
      }
    });
  } catch (error) {
    logger.error('Error in getUserProfile:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data profil'
    });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'Semua field harus diisi'
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'Konfirmasi password tidak cocok'
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password baru minimal 8 karakter'
      });
    }

    // Get user from database
    const user = await executeQuery(async (connection) => {
      return await User.findById(userId, connection);
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan'
      });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(current_password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Password saat ini tidak valid'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    // Update password in database
    await executeQuery(async (connection) => {
      return await User.update(userId, { password: hashedPassword }, connection);
    });

    res.json({
      success: true,
      message: 'Password berhasil diubah'
    });
  } catch (error) {
    logger.error('Error in changePassword:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengubah password'
    });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const resetToken = await executeQuery(async (connection) => {
      return await User.setResetPasswordToken(email, connection);
    });
    if (!resetToken) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    await sendPasswordResetEmail(email, resetLink);

    logger.info(`Password reset requested for: ${email}`);
    res.json({ message: 'Email reset password telah dikirim' });
  } catch (error) {
    logger.error(`Forgot password error: ${error.message}`, { error });
    res.status(500).json({ message: 'Terjadi kesalahan saat memproses permintaan reset password' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const user = await executeQuery(async (connection) => {
      return await User.resetPassword(token, newPassword, connection);
    });

    if (!user) {
      return res.status(400).json({ message: 'Token reset password tidak valid atau sudah kadaluarsa' });
    }

    await sendNotificationEmail(user.email, 'Password Anda telah berhasil direset');
    logger.info(`Password reset successful for: ${user.email}`);
    res.json({ message: 'Password berhasil direset' });
  } catch (error) {
    logger.error(`Reset password error: ${error.message}`, { error });
    res.status(500).json({ message: 'Terjadi kesalahan saat mereset password' });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil data pengguna' });
  }
};

exports.checkAuth = async (req, res) => {
  try {
    // Cek refresh token dari cookie
    const refreshToken = req.cookies.refreshToken;

    // Access token seharusnya dikirim via Authorization header
    const accessToken = req.headers.authorization?.split(' ')[1];

    logger.info('Auth check:', {
      tokens: {
        hasRefresh: !!refreshToken,
        hasAccess: !!accessToken,
      },
      headers: {
        authorization: !!req.headers.authorization,
        host: req.get('host')
      }
    });

    let isRefreshTokenValid = false;
    let isAccessTokenValid = false;

    if (refreshToken) {
      const [[tokenRecord]] = await executeQuery(async (connection) => {
        return await connection.query(
          `SELECT * FROM user_tokens
           WHERE token = ?
           AND type = 'refresh'
           AND expires_at > NOW()`,
          [refreshToken]
        );
      });
      isRefreshTokenValid = !!tokenRecord;
      logger.info('Refresh token check:', { isValid: isRefreshTokenValid });
    }

    if (accessToken) {
      try {
        jwt.verify(accessToken, TOKEN_CONFIG.ACCESS.secret);
        isAccessTokenValid = true;
      } catch (err) {
        logger.warn('Access token verification failed:', err.message);
        isAccessTokenValid = false;
      }
      logger.info('Access token check:', { isValid: isAccessTokenValid });
    }

    res.json({
      isAuthenticated: isAccessTokenValid || isRefreshTokenValid,
      tokenStatus: {
        accessToken: isAccessTokenValid ? 'valid' : 'invalid',
        refreshToken: isRefreshTokenValid ? 'valid' : 'invalid'
      }
    });

  } catch (error) {
    logger.error('Auth check failed:', error);
    res.status(500).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
};

exports.getCsrfToken = (req, res) => {
  try {
    // Set header cache
    res.set('Cache-Control', 'private, max-age=300'); // Cache 5 menit

    // Generate token
    const token = req.csrfToken();

    res.json({
      csrfToken: token,
      expires: new Date(Date.now() + 300000).toISOString() // 5 menit
    });
  } catch (error) {
    logger.error('Error generating CSRF token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.checkTokenStatus = async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.split(' ')[1];
    if (!accessToken) {
      return res.json({ shouldRefresh: true });
    }

    const decoded = jwt.decode(accessToken);
    const currentTime = Date.now() / 1000;
    const timeLeft = decoded.exp - currentTime;

    logger.info('Token status check:', {
      timeLeft: `${Math.floor(timeLeft/60)} minutes`,
      shouldRefresh: timeLeft < 120 // refresh if less than 2 minutes left
    });

    res.json({
      shouldRefresh: timeLeft < 120,
      timeLeft: Math.floor(timeLeft)
    });

  } catch (error) {
    logger.error('Token status check error:', error);
    res.json({ shouldRefresh: true });
  }
};

// Fungsi untuk membuat refresh token jika belum ada
// Periksa apakah fungsi ini sudah ada di file, jika belum, tambahkan
const createRefreshToken = async (userId, expiresIn) => {
  try {
    // Generate token unik
    const tokenValue = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Gunakan executeQuery jika itu yang digunakan di aplikasi
    await executeQuery(async (connection) => {
      // Hapus token lama untuk user ini
      await connection.query(
        'DELETE FROM user_tokens WHERE user_id = ? AND token_type = "refresh"',
        [userId]
      );

      // Buat token baru
      await connection.query(
        'INSERT INTO user_tokens (user_id, token, token_type, expires_at, created_at) VALUES (?, ?, "refresh", ?, NOW())',
        [userId, tokenValue, expiresAt]
      );
    });

    return tokenValue;
  } catch (error) {
    logger.error('Error creating refresh token:', error);
    throw new Error('Failed to create refresh token');
  }
};

// Alternatif jika menggunakan User model
const createRefreshTokenWithModel = async (userId, expiresIn) => {
  try {
    // Generate token unik
    const tokenValue = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Gunakan User model jika tersedia
    await User.saveRefreshToken(
      userId,
      tokenValue,
      expiresAt
    );

    return tokenValue;
  } catch (error) {
    logger.error('Error creating refresh token:', error);
    throw new Error('Failed to create refresh token');
  }
};

