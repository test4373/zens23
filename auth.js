import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbGet, dbRun, dbAll } from './database.js';
import chalk from 'chalk';

// JWT secret - Production'da bu environment variable olmalı
const JWT_SECRET = process.env.JWT_SECRET || 'zenshin_ultra_secure_secret_key_change_in_production_2024';
const JWT_EXPIRES_IN = '7d'; // 7 gün

// Şifre hashleme
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12); // 12 rounds - çok güvenli
  return bcrypt.hash(password, salt);
}

// Şifre doğrulama
export async function verifyPassword(password, hashedPassword) {
  return bcrypt.compare(password, hashedPassword);
}

// JWT token oluşturma
export function generateToken(userId, username) {
  return jwt.sign(
    { 
      userId, 
      username,
      iat: Math.floor(Date.now() / 1000)
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// JWT token doğrulama
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Authentication middleware
export async function authMiddleware(req, res, next) {
  try {
    console.log(chalk.blue('🔐 Auth Check:'), req.method, req.path);
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log(chalk.red('❌ No auth header'));
      return res.status(401).json({ 
        success: false, 
        message: 'Yetkilendirme token\'ı bulunamadı' 
      });
    }

    const token = authHeader.substring(7);
    console.log(chalk.cyan('🎫 Token:'), token.substring(0, 20) + '...');
    
    const decoded = verifyToken(token);

    if (!decoded) {
      console.log(chalk.red('❌ Invalid token'));
      return res.status(401).json({ 
        success: false, 
        message: 'Geçersiz veya süresi dolmuş token' 
      });
    }

    console.log(chalk.green('✅ Token decoded:'), decoded);

    // Token'ın aktif bir oturuma ait olup olmadığını kontrol et
    const session = await dbGet(
      'SELECT * FROM user_sessions WHERE token = ? AND expires_at > datetime("now")',
      [token]
    );

    console.log(chalk.cyan('🗄️ Session:'), session ? 'Found' : 'Not found');

    if (!session) {
      console.log(chalk.red('❌ No active session'));
      return res.status(401).json({ 
        success: false, 
        message: 'Oturum bulunamadı veya süresi doldu' 
      });
    }

    // Kullanıcı bilgilerini request'e ekle
    req.userId = decoded.userId;
    req.username = decoded.username;
    req.user = {
      userId: decoded.userId,
      username: decoded.username
    };

    console.log(chalk.green('✅ Auth successful, userId:'), req.userId);
    next();
  } catch (error) {
    console.error(chalk.red('Auth middleware error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Yetkilendirme hatası' 
    });
  }
}

// Başarısız giriş denemelerini kontrol et (Brute force koruması)
export async function checkFailedAttempts(identifier, ipAddress) {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  
  const attempts = await dbAll(
    `SELECT COUNT(*) as count FROM failed_login_attempts 
     WHERE (identifier = ? OR ip_address = ?) 
     AND attempted_at > ?`,
    [identifier, ipAddress, fifteenMinutesAgo]
  );

  return attempts[0].count >= 5; // 15 dakikada 5'ten fazla deneme
}

// Başarısız giriş denemesini kaydet
export async function recordFailedAttempt(identifier, ipAddress) {
  await dbRun(
    'INSERT INTO failed_login_attempts (identifier, ip_address) VALUES (?, ?)',
    [identifier, ipAddress]
  );
}

// Eski başarısız denemeleri temizle
export async function clearFailedAttempts(identifier) {
  await dbRun(
    'DELETE FROM failed_login_attempts WHERE identifier = ?',
    [identifier]
  );
}

// Kullanıcı oturumu oluştur
export async function createUserSession(userId, token, ipAddress, userAgent) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 gün
  
  await dbRun(
    `INSERT INTO user_sessions (user_id, token, ip_address, user_agent, expires_at) 
     VALUES (?, ?, ?, ?, ?)`,
    [userId, token, ipAddress, userAgent, expiresAt]
  );
}

// Kullanıcı oturumunu sonlandır
export async function destroyUserSession(token) {
  await dbRun(
    'DELETE FROM user_sessions WHERE token = ?',
    [token]
  );
}

// Kullanıcının tüm oturumlarını sonlandır
export async function destroyAllUserSessions(userId) {
  await dbRun(
    'DELETE FROM user_sessions WHERE user_id = ?',
    [userId]
  );
}

// Süresi dolmuş oturumları temizle (günlük çalıştırılmalı)
export async function cleanupExpiredSessions() {
  await dbRun(
    'DELETE FROM user_sessions WHERE expires_at < datetime("now")'
  );
  console.log(chalk.yellow('✓ Expired sessions cleaned up'));
}

// Süresi dolmuş başarısız denemeleri temizle
export async function cleanupOldFailedAttempts() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await dbRun(
    'DELETE FROM failed_login_attempts WHERE attempted_at < ?',
    [oneDayAgo]
  );
  console.log(chalk.yellow('✓ Old failed attempts cleaned up'));
}

// Her gün otomatik temizlik
setInterval(() => {
  cleanupExpiredSessions();
  cleanupOldFailedAttempts();
}, 24 * 60 * 60 * 1000); // 24 saat

export default {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  authMiddleware,
  checkFailedAttempts,
  recordFailedAttempt,
  clearFailedAttempts,
  createUserSession,
  destroyUserSession,
  destroyAllUserSessions,
  cleanupExpiredSessions,
  cleanupOldFailedAttempts
};
