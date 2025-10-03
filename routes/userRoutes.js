import express from 'express';
import { body, validationResult } from 'express-validator';
import { dbGet, dbRun, dbAll } from '../database.js';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  authMiddleware,
  checkFailedAttempts,
  recordFailedAttempt,
  clearFailedAttempts,
  createUserSession,
  destroyUserSession,
  destroyAllUserSessions
} from '../auth.js';
import chalk from 'chalk';

const router = express.Router();

// Input sanitization ve validation
const registerValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Kullanıcı adı 3-20 karakter olmalıdır')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Kullanıcı adı sadece harf, rakam ve alt çizgi içerebilir'),
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('Geçerli bir email adresi giriniz'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Şifre en az 8 karakter olmalıdır')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Şifre en az bir büyük harf, bir küçük harf ve bir rakam içermelidir')
];

const loginValidation = [
  body('identifier').trim().notEmpty().withMessage('Email veya kullanıcı adı gereklidir'),
  body('password').notEmpty().withMessage('Şifre gereklidir')
];

// Kullanıcı kaydı
router.post('/register', registerValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { username, email, password } = req.body;

    // Kullanıcı adı kontrolü
    const existingUser = await dbGet(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUser) {
      return res.status(409).json({ 
        success: false, 
        message: 'Bu kullanıcı adı veya email zaten kullanılıyor' 
      });
    }

    // Şifreyi hashle
    const hashedPassword = await hashPassword(password);

    // Kullanıcıyı oluştur
    const result = await dbRun(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, email, hashedPassword]
    );

    console.log(chalk.green(`✓ New user registered: ${username}`));

    // Token oluştur
    const token = generateToken(result.id, username);

    // Oturum oluştur
    await createUserSession(
      result.id,
      token,
      req.ip,
      req.headers['user-agent']
    );

    res.status(201).json({
      success: true,
      message: 'Kayıt başarılı',
      data: {
        userId: result.id,
        username,
        email,
        token
      }
    });
  } catch (error) {
    console.error(chalk.red('Register error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Kayıt sırasında bir hata oluştu' 
    });
  }
});

// Kullanıcı girişi
router.post('/login', loginValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { identifier, password } = req.body;
    const ipAddress = req.ip;

    // Brute force kontrolü
    const isBlocked = await checkFailedAttempts(identifier, ipAddress);
    if (isBlocked) {
      return res.status(429).json({ 
        success: false, 
        message: 'Çok fazla başarısız deneme. Lütfen 15 dakika sonra tekrar deneyin' 
      });
    }

    // Kullanıcıyı bul (email veya username ile)
    const user = await dbGet(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [identifier, identifier]
    );

    if (!user) {
      await recordFailedAttempt(identifier, ipAddress);
      return res.status(401).json({ 
        success: false, 
        message: 'Kullanıcı adı/email veya şifre hatalı' 
      });
    }

    // Şifre kontrolü
    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) {
      await recordFailedAttempt(identifier, ipAddress);
      return res.status(401).json({ 
        success: false, 
        message: 'Kullanıcı adı/email veya şifre hatalı' 
      });
    }

    // Başarılı giriş - başarısız denemeleri temizle
    await clearFailedAttempts(identifier);

    // Son giriş zamanını güncelle
    await dbRun(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    // Token oluştur
    const token = generateToken(user.id, user.username);

    // Oturum oluştur
    await createUserSession(
      user.id,
      token,
      ipAddress,
      req.headers['user-agent']
    );

    console.log(chalk.green(`✓ User logged in: ${user.username}`));

    res.json({
      success: true,
      message: 'Giriş başarılı',
      data: {
        userId: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        token
      }
    });
  } catch (error) {
    console.error(chalk.red('Login error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Giriş sırasında bir hata oluştu' 
    });
  }
});

// Kullanıcı çıkışı
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization.substring(7);
    await destroyUserSession(token);

    console.log(chalk.yellow(`✓ User logged out: ${req.user.username}`));

    res.json({
      success: true,
      message: 'Çıkış başarılı'
    });
  } catch (error) {
    console.error(chalk.red('Logout error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Çıkış sırasında bir hata oluştu' 
    });
  }
});

// Kullanıcı bilgilerini getir
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await dbGet(
      'SELECT id, username, email, avatar, bio, banner, created_at, last_login FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Kullanıcı bulunamadı' 
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error(chalk.red('Get profile error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Profil bilgileri alınırken hata oluştu' 
    });
  }
});

// Kullanıcı bilgilerini güncelle
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { bio, avatar, banner } = req.body;
    const updates = [];
    const values = [];

    console.log(chalk.cyan('📝 Profile update request:'), { bio, avatar, banner });

    // Bio validation (optional)
    if (bio !== undefined) {
      if (bio.length > 500) {
        return res.status(400).json({ 
          success: false, 
          message: 'Bio çok uzun (max 500 karakter)' 
        });
      }
      updates.push('bio = ?');
      values.push(bio.trim());
    }
    
    // Avatar (URL or base64)
    if (avatar !== undefined && avatar.trim()) {
      updates.push('avatar = ?');
      values.push(avatar.trim());
    }
    
    // Banner (URL or base64)
    if (banner !== undefined && banner.trim()) {
      updates.push('banner = ?');
      values.push(banner.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Güncellenecek alan bulunamadı' 
      });
    }
    
    console.log(chalk.yellow('✏️ Updating fields:'), updates);

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.user.userId);

    await dbRun(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    console.log(chalk.green(`✅ Profile updated: ${req.user.username}`));
    console.log(chalk.green(`📊 Updated ${updates.length} field(s)`));

    res.json({
      success: true,
      message: 'Profil güncellendi'
    });
  } catch (error) {
    console.error(chalk.red('Update profile error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Profil güncellenirken hata oluştu' 
    });
  }
});

// Email değiştir
router.put('/change-email', authMiddleware, [
  body('newEmail')
    .trim()
    .isEmail()
    .normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { newEmail } = req.body;

    // Email kullanımda mı kontrol et
    const existing = await dbGet(
      'SELECT id FROM users WHERE email = ?',
      [newEmail]
    );

    if (existing) {
      return res.status(409).json({ 
        success: false, 
        message: 'Bu email adresi zaten kullanılıyor' 
      });
    }

    await dbRun(
      'UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newEmail, req.user.userId]
    );

    console.log(chalk.green(`✓ Email changed: ${req.user.username}`));

    res.json({
      success: true,
      message: 'Email adresi değiştirildi'
    });
  } catch (error) {
    console.error(chalk.red('Change email error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Email değiştirilirken hata oluştu' 
    });
  }
});

// Kullanıcı adını değiştir
router.put('/change-username', authMiddleware, [
  body('newUsername')
    .trim()
    .isLength({ min: 3, max: 20 })
    .matches(/^[a-zA-Z0-9_]+$/)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { newUsername } = req.body;

    // Kullanıcı adı kullanımda mı kontrol et
    const existing = await dbGet(
      'SELECT id FROM users WHERE username = ?',
      [newUsername]
    );

    if (existing) {
      return res.status(409).json({ 
        success: false, 
        message: 'Bu kullanıcı adı zaten kullanılıyor' 
      });
    }

    await dbRun(
      'UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newUsername, req.user.userId]
    );

    console.log(chalk.green(`✓ Username changed: ${req.user.username} → ${newUsername}`));

    res.json({
      success: true,
      message: 'Kullanıcı adı değiştirildi'
    });
  } catch (error) {
    console.error(chalk.red('Change username error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Kullanıcı adı değiştirilirken hata oluştu' 
    });
  }
});

// Şifre değiştir
router.put('/change-password', authMiddleware, [
  body('currentPassword').notEmpty(),
  body('newPassword')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { currentPassword, newPassword } = req.body;

    // Mevcut şifreyi kontrol et
    const user = await dbGet(
      'SELECT password FROM users WHERE id = ?',
      [req.user.userId]
    );

    const isPasswordValid = await verifyPassword(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Mevcut şifre hatalı' 
      });
    }

    // Yeni şifreyi hashle
    const hashedPassword = await hashPassword(newPassword);

    await dbRun(
      'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedPassword, req.user.userId]
    );

    // Güvenlik için tüm oturumları sonlandır (mevcut oturum hariç)
    const currentToken = req.headers.authorization.substring(7);
    await dbRun(
      'DELETE FROM user_sessions WHERE user_id = ? AND token != ?',
      [req.user.userId, currentToken]
    );

    console.log(chalk.green(`✓ Password changed: ${req.user.username}`));

    res.json({
      success: true,
      message: 'Şifre değiştirildi. Diğer oturumlar sonlandırıldı.'
    });
  } catch (error) {
    console.error(chalk.red('Change password error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Şifre değiştirilirken hata oluştu' 
    });
  }
});

// Kullanıcıyı ID ile getir (public)
router.get('/:userId', async (req, res) => {
  try {
    const user = await dbGet(
      'SELECT id, username, avatar, bio, banner, created_at FROM users WHERE id = ?',
      [req.params.userId]
    );

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Kullanıcı bulunamadı' 
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error(chalk.red('Get user error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Kullanıcı bilgileri alınırken hata oluştu' 
    });
  }
});

export default router;
