import express from 'express';
import { authMiddleware } from '../auth.js';
import { dbGet, dbAll, dbRun } from '../database.js';
import { checkProfanity } from '../utils/profanityFilter.js';

const router = express.Router();

// Tüm yorumları getir (anime bazlı)
router.get('/anime/:animeId', async (req, res) => {
  try {
    const { animeId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const comments = await dbAll(`
      SELECT
        c.*,
        u.username,
        u.avatar,
        COUNT(cl.id) as likes_count,
        CASE WHEN ? THEN 1 ELSE 0 END as is_liked
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN comment_likes cl ON c.id = cl.comment_id
      WHERE c.anime_id = ? AND c.parent_id IS NULL
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `, [req.user?.userId, animeId, limit, offset]);

    // Her yorum için yanıtları getir
    for (const comment of comments) {
      comment.replies = await dbAll(`
        SELECT
          c.*,
          u.username,
          u.avatar,
          COUNT(cl.id) as likes_count,
          CASE WHEN ? THEN 1 ELSE 0 END as is_liked
        FROM comments c
        LEFT JOIN users u ON c.user_id = u.id
        LEFT JOIN comment_likes cl ON c.id = cl.comment_id
        WHERE c.parent_id = ?
        GROUP BY c.id
        ORDER BY c.created_at ASC
      `, [req.user?.userId, comment.id]);
    }

    res.json({
      success: true,
      data: comments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({
      success: false,
      message: 'Yorumlar yüklenirken hata oluştu'
    });
  }
});

// Yeni yorum ekle
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { anime_id, content, parent_id } = req.body;
    const user_id = req.user.userId;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Yorum içeriği boş olamaz'
      });
    }

    // Profanity kontrolü
    const profanityCheck = checkProfanity(content);
    if (!profanityCheck.isClean) {
      console.log('❌ Profanity detected in comment:', profanityCheck.bannedWords);
      return res.status(400).json({
        success: false,
        message: 'Yorumunuz uygunsuz kelime içeriyor. Lütfen düzeltin.'
      });
    }

    // Mention'ları işle (@username formatında)
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;

    while ((match = mentionRegex.exec(content)) !== null) {
      const username = match[1];
      const user = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
      if (user) {
        mentions.push(user.id);
      }
    }

    // Yorumu ekle
    const result = await dbRun(
      'INSERT INTO comments (user_id, anime_id, content, parent_id) VALUES (?, ?, ?, ?)',
      [user_id, anime_id, content.trim(), parent_id || null]
    );

    const commentId = result.id;

    // Mention'ları kaydet
    for (const mentionedUserId of mentions) {
      await dbRun(
        'INSERT INTO mentions (comment_id, mentioned_user_id) VALUES (?, ?)',
        [commentId, mentionedUserId]
      );
    }

    // Oluşturulan yorumu getir
    const comment = await dbGet(`
      SELECT
        c.*,
        u.username,
        u.avatar,
        0 as likes_count,
        0 as is_liked
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [commentId]);

    res.status(201).json({
      success: true,
      data: comment,
      mentions: mentions.length
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({
      success: false,
      message: 'Yorum eklenirken hata oluştu'
    });
  }
});

// Yorumu beğen/beğenmeyi kaldır
router.post('/:commentId/like', authMiddleware, async (req, res) => {
  try {
    const { commentId } = req.params;
    const user_id = req.user.userId;

    // Zaten beğenmiş mi kontrol et
    const existingLike = await dbGet(
      'SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?',
      [user_id, commentId]
    );

    if (existingLike) {
      // Beğenmeyi kaldır
      await dbRun(
        'DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?',
        [user_id, commentId]
      );
      res.json({ success: true, action: 'unliked' });
    } else {
      // Beğeni ekle
      await dbRun(
        'INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)',
        [user_id, commentId]
      );
      res.json({ success: true, action: 'liked' });
    }
  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({
      success: false,
      message: 'Beğeni işlemi sırasında hata oluştu'
    });
  }
});

// Yorumu sil
router.delete('/:commentId', authMiddleware, async (req, res) => {
  try {
    const { commentId } = req.params;
    const user_id = req.user.userId;

    // Yorumun sahibi mi kontrol et
    const comment = await dbGet('SELECT user_id FROM comments WHERE id = ?', [commentId]);

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Yorum bulunamadı'
      });
    }

    if (comment.user_id !== user_id) {
      return res.status(403).json({
        success: false,
        message: 'Bu yorumu silme yetkiniz yok'
      });
    }

    await dbRun('DELETE FROM comments WHERE id = ?', [commentId]);

    res.json({ success: true, message: 'Yorum başarıyla silindi' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({
      success: false,
      message: 'Yorum silinirken hata oluştu'
    });
  }
});

// Kullanıcının mention'larını getir
router.get('/mentions/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    // Sadece kendi mention'larını görebilir
    if (req.user.userId != userId) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için yetkiniz yok'
      });
    }

    const mentions = await dbAll(`
      SELECT
        m.*,
        c.content as comment_content,
        c.anime_id,
        u.username as mentioner_username,
        u.avatar as mentioner_avatar
      FROM mentions m
      LEFT JOIN comments c ON m.comment_id = c.id
      LEFT JOIN users u ON c.user_id = u.id
      WHERE m.mentioned_user_id = ?
      ORDER BY m.created_at DESC
      LIMIT 50
    `, [userId]);

    res.json({
      success: true,
      data: mentions
    });
  } catch (error) {
    console.error('Error fetching mentions:', error);
    res.status(500).json({
      success: false,
      message: 'Mention\'lar yüklenirken hata oluştu'
    });
  }
});

export default router;
