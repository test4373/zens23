import express from 'express';
import { body, validationResult } from 'express-validator';
import { dbGet, dbRun, dbAll } from '../database.js';
import { authMiddleware } from '../auth.js';
import chalk from 'chalk';

const router = express.Router();

// İzleme geçmişine ekle veya güncelle (sendBeacon için token optional)
router.post('/history', authMiddleware, [
  body('animeId').notEmpty(),
  body('animeTitle').notEmpty(),
  body('animeImage').optional(),
  body('episodeNumber').optional().isInt(),
  body('progress').optional().isFloat({ min: 0, max: 100 }),
  body('currentTime').optional().isFloat({ min: 0 }),
  body('magnetUri').optional(),
  body('watchTime').optional().isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { animeId, animeTitle, animeImage, episodeNumber, progress, currentTime, magnetUri, watchTime } = req.body;

    // Mevcut kaydı kontrol et (anime_id, episode_number VE magnet_uri ile)
    const existing = await dbGet(
      'SELECT id, watch_time FROM watch_history WHERE user_id = ? AND anime_id = ? AND episode_number = ? AND magnet_uri = ?',
      [req.user.userId, animeId, episodeNumber, magnetUri]
    );

    if (existing) {
      // Güncelle - EN SON hal her zaman kaydedilir
      const newWatchTime = (existing.watch_time || 0) + (watchTime || 0);
      await dbRun(
        `UPDATE watch_history 
         SET anime_title = ?, anime_image = ?, 
             progress = ?, current_time = ?, watch_time = ?, last_watched = CURRENT_TIMESTAMP, status = 'watching'
         WHERE id = ?`,
        [animeTitle, animeImage, progress, currentTime, newWatchTime, existing.id]
      );
      console.log(`✅ Updated existing record: ${animeTitle} Ep${episodeNumber} @ ${currentTime?.toFixed(1)}s`);
    } else {
      // Yeni kayıt
      await dbRun(
        `INSERT INTO watch_history 
         (user_id, anime_id, anime_title, anime_image, episode_number, progress, current_time, magnet_uri, watch_time, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'watching')`,
        [req.user.userId, animeId, animeTitle, animeImage, episodeNumber, progress, currentTime, magnetUri, watchTime || 0]
      );
      console.log(`➕ Created new record: ${animeTitle} Ep${episodeNumber} @ ${currentTime?.toFixed(1)}s`);
    }

    res.json({
      success: true,
      message: 'İzleme geçmişi güncellendi'
    });
  } catch (error) {
    console.error(chalk.red('Update watch history error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'İzleme geçmişi güncellenirken hata oluştu' 
    });
  }
});

// Kullanıcının izleme geçmişini getir
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const history = await dbAll(
      `SELECT * FROM watch_history 
       WHERE user_id = ? AND status = 'watching'
       ORDER BY last_watched DESC 
       LIMIT ? OFFSET ?`,
      [req.user.userId, limit, offset]
    );

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error(chalk.red('Get watch history error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'İzleme geçmişi alınırken hata oluştu' 
    });
  }
});

// Son izlenen animeyi getir (ana sayfa için)
router.get('/last-watched', authMiddleware, async (req, res) => {
  try {
    const lastWatched = await dbGet(
      `SELECT * FROM watch_history 
       WHERE user_id = ? AND status = 'watching'
       ORDER BY last_watched DESC 
       LIMIT 1`,
      [req.user.userId]
    );

    res.json({
      success: true,
      data: lastWatched || null
    });
  } catch (error) {
    console.error(chalk.red('Get last watched error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Son izlenen anime alınırken hata oluştu' 
    });
  }
});

// Belirli bir kullanıcının son izlenen animesini getir (public)
router.get('/last-watched/:userId', async (req, res) => {
  try {
    const lastWatched = await dbGet(
      `SELECT anime_id, anime_title, anime_image, episode_number, last_watched 
       FROM watch_history 
       WHERE user_id = ? AND status = 'watching'
       ORDER BY last_watched DESC 
       LIMIT 1`,
      [req.params.userId]
    );

    res.json({
      success: true,
      data: lastWatched || null
    });
  } catch (error) {
    console.error(chalk.red('Get user last watched error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Kullanıcının son izlenen animesi alınırken hata oluştu' 
    });
  }
});

// Tamamlanan animelere ekle
router.post('/completed', authMiddleware, [
  body('animeId').notEmpty(),
  body('animeTitle').notEmpty(),
  body('animeImage').optional(),
  body('rating').optional().isInt({ min: 1, max: 10 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { animeId, animeTitle, animeImage, rating } = req.body;

    // Mevcut kaydı kontrol et
    const existing = await dbGet(
      'SELECT id FROM completed_anime WHERE user_id = ? AND anime_id = ?',
      [req.user.userId, animeId]
    );

    if (existing) {
      // Güncelle
      await dbRun(
        `UPDATE completed_anime 
         SET anime_title = ?, anime_image = ?, rating = ?, completed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [animeTitle, animeImage, rating, existing.id]
      );
    } else {
      // Yeni kayıt
      await dbRun(
        `INSERT INTO completed_anime 
         (user_id, anime_id, anime_title, anime_image, rating) 
         VALUES (?, ?, ?, ?, ?)`,
        [req.user.userId, animeId, animeTitle, animeImage, rating]
      );
    }

    // İzleme geçmişindeki durumu güncelle
    await dbRun(
      `UPDATE watch_history SET status = 'completed' WHERE user_id = ? AND anime_id = ?`,
      [req.user.userId, animeId]
    );

    console.log(chalk.green(`✓ Anime marked as completed: ${animeTitle} by ${req.user.username}`));

    res.json({
      success: true,
      message: 'Anime tamamlandı olarak işaretlendi'
    });
  } catch (error) {
    console.error(chalk.red('Mark as completed error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Anime tamamlandı olarak işaretlenirken hata oluştu' 
    });
  }
});

// Tamamlanan animeleri getir
router.get('/completed', authMiddleware, async (req, res) => {
  try {
    const completed = await dbAll(
      `SELECT * FROM completed_anime 
       WHERE user_id = ? 
       ORDER BY completed_at DESC`,
      [req.user.userId]
    );

    res.json({
      success: true,
      data: completed
    });
  } catch (error) {
    console.error(chalk.red('Get completed anime error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Tamamlanan animeler alınırken hata oluştu' 
    });
  }
});

// Belirli bir kullanıcının tamamladığı animeleri getir (public)
router.get('/completed/:userId', async (req, res) => {
  try {
    const completed = await dbAll(
      `SELECT anime_id, anime_title, anime_image, rating, completed_at 
       FROM completed_anime 
       WHERE user_id = ? 
       ORDER BY completed_at DESC`,
      [req.params.userId]
    );

    res.json({
      success: true,
      data: completed
    });
  } catch (error) {
    console.error(chalk.red('Get user completed anime error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Kullanıcının tamamladığı animeler alınırken hata oluştu' 
    });
  }
});

// Favorilere ekle
router.post('/favorites', authMiddleware, [
  body('animeId').notEmpty(),
  body('animeTitle').notEmpty(),
  body('animeImage').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { animeId, animeTitle, animeImage } = req.body;

    // Mevcut kaydı kontrol et
    const existing = await dbGet(
      'SELECT id FROM favorites WHERE user_id = ? AND anime_id = ?',
      [req.user.userId, animeId]
    );

    if (existing) {
      return res.status(409).json({ 
        success: false, 
        message: 'Bu anime zaten favorilerde' 
      });
    }

    await dbRun(
      `INSERT INTO favorites (user_id, anime_id, anime_title, anime_image) 
       VALUES (?, ?, ?, ?)`,
      [req.user.userId, animeId, animeTitle, animeImage]
    );

    res.json({
      success: true,
      message: 'Anime favorilere eklendi'
    });
  } catch (error) {
    console.error(chalk.red('Add to favorites error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Favorilere eklenirken hata oluştu' 
    });
  }
});

// Favorilerden çıkar
router.delete('/favorites/:animeId', authMiddleware, async (req, res) => {
  try {
    await dbRun(
      'DELETE FROM favorites WHERE user_id = ? AND anime_id = ?',
      [req.user.userId, req.params.animeId]
    );

    res.json({
      success: true,
      message: 'Anime favorilerden çıkarıldı'
    });
  } catch (error) {
    console.error(chalk.red('Remove from favorites error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Favorilerden çıkarılırken hata oluştu' 
    });
  }
});

// Favorileri getir
router.get('/favorites', authMiddleware, async (req, res) => {
  try {
    const favorites = await dbAll(
      `SELECT * FROM favorites 
       WHERE user_id = ? 
       ORDER BY added_at DESC`,
      [req.user.userId]
    );

    res.json({
      success: true,
      data: favorites
    });
  } catch (error) {
    console.error(chalk.red('Get favorites error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Favoriler alınırken hata oluştu' 
    });
  }
});

// Belirli bir kullanıcının favorilerini getir (public)
router.get('/favorites/:userId', async (req, res) => {
  try {
    const favorites = await dbAll(
      `SELECT anime_id, anime_title, anime_image, added_at 
       FROM favorites 
       WHERE user_id = ? 
       ORDER BY added_at DESC`,
      [req.params.userId]
    );

    res.json({
      success: true,
      data: favorites
    });
  } catch (error) {
    console.error(chalk.red('Get user favorites error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'Kullanıcının favorileri alınırken hata oluştu' 
    });
  }
});

// İzleme geçmişinden anime sil
router.delete('/history/:animeId', authMiddleware, async (req, res) => {
  try {
    await dbRun(
      'DELETE FROM watch_history WHERE user_id = ? AND anime_id = ?',
      [req.user.userId, req.params.animeId]
    );

    res.json({
      success: true,
      message: 'İzleme geçmişinden silindi'
    });
  } catch (error) {
    console.error(chalk.red('Delete from watch history error:'), error);
    res.status(500).json({ 
      success: false, 
      message: 'İzleme geçmişinden silinirken hata oluştu' 
    });
  }
});

export default router;
