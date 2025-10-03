import express from 'express';
import { authMiddleware } from '../auth.js';
import { dbGet, dbAll, dbRun } from '../database.js';
import chalk from 'chalk';
import { searchTorrentsAnimeTosho } from './torrentSearch.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/subtitles');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.srt', '.ass', '.vtt', '.7z', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Sadece .srt, .ass, .vtt, .7z, .zip dosyaları yüklenebilir'));
    }
  }
});

const router = express.Router();

// Admin middleware
const adminMiddleware = async (req, res, next) => {
  try {
    const userId = req.userId;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const admin = await dbGet(
      'SELECT * FROM admin_users WHERE user_id = ?',
      [userId]
    );
    
    if (!admin) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkisi gerekli!'
      });
    }
    
    req.isAdmin = true;
    req.adminPermissions = admin.permissions;
    next();
  } catch (error) {
    console.error(chalk.red('Admin middleware error:'), error);
    res.status(500).json({ success: false, message: 'Yetki kontrolü başarısız' });
  }
};

router.use(authMiddleware);
router.use(adminMiddleware);

/* ADMIN USER MANAGEMENT */
router.post('/users/grant-admin', async (req, res) => {
  try {
    const { username, permissions = 'all' } = req.body;
    const user = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı' });
    }
    
    await dbRun(
      'INSERT OR REPLACE INTO admin_users (user_id, granted_by, permissions) VALUES (?, ?, ?)',
      [user.id, req.userId, permissions]
    );
    
    res.json({ success: true, message: `${username} artık admin!` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/users/revoke-admin/:username', async (req, res) => {
  try {
    const user = await dbGet('SELECT id FROM users WHERE username = ?', [req.params.username]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı' });
    }
    await dbRun('DELETE FROM admin_users WHERE user_id = ?', [user.id]);
    res.json({ success: true, message: `${req.params.username} artık admin değil` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/users/admins', async (req, res) => {
  try {
    const admins = await dbAll(`
      SELECT 
        u.id, u.username, u.email,
        CASE 
          WHEN u.avatar LIKE 'data:%' THEN '/zenshin/default-avatar.png'
          ELSE u.avatar
        END as avatar,
        a.granted_at, a.permissions,
        g.username as granted_by_username
      FROM admin_users a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN users g ON a.granted_by = g.id
      ORDER BY a.granted_at DESC
    `);
    console.log(chalk.green(`✅ Returning ${admins.length} admins`));
    res.json({ success: true, data: admins });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 4K EPISODE MANAGEMENT */
router.post('/episodes/add-4k', async (req, res) => {
  try {
    const { animeId, animeTitle, episodeNumber, storageType, storageUrl, fileSize } = req.body;
    
    if (!animeId || !episodeNumber || !storageUrl) {
      return res.status(400).json({
        success: false,
        message: 'Anime ID, episode number ve storage URL gerekli!'
      });
    }
    
    const result = await dbRun(`
      INSERT OR REPLACE INTO episodes_4k 
      (anime_id, anime_title, episode_number, storage_type, storage_url, file_size, upscaled_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [animeId, animeTitle, episodeNumber, storageType, storageUrl, fileSize, req.userId]);
    
    res.json({ success: true, message: '4K episode başarıyla eklendi!', id: result.id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/episodes/4k/:animeId', async (req, res) => {
  try {
    const episodes = await dbAll(`
      SELECT e.*, u.username as upscaled_by_username
      FROM episodes_4k e
      LEFT JOIN users u ON e.upscaled_by = u.id
      WHERE e.anime_id = ?
      ORDER BY e.episode_number ASC
    `, [req.params.animeId]);
    res.json({ success: true, data: episodes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/episodes/4k/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM episodes_4k WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: '4K episode silindi' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/episodes/4k', async (req, res) => {
  try {
    const episodes = await dbAll(`
      SELECT e.*, u.username as upscaled_by_username
      FROM episodes_4k e
      LEFT JOIN users u ON e.upscaled_by = u.id
      ORDER BY e.uploaded_at DESC
      LIMIT 100
    `);
    res.json({ success: true, data: episodes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/* SUBTITLE MANAGEMENT */

// Torrent ara (AnimeTosho) - Altyazı paketleri için
router.get('/torrents/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ success: false, message: 'Arama sorgusu gerekli!' });
    }
    
    const torrents = await searchTorrentsAnimeTosho(query);
    res.json({ success: true, data: torrents });
  } catch (error) {
    console.error(chalk.red('Torrent search error:'), error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// MKV dosyaları ara (AnimeTosho) - Tekil bölümler için
router.get('/mkv/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ success: false, message: 'Arama sorgusu gerekli!' });
    }
    
    console.log(chalk.blue('🎬 Searching MKV files:'), query);
    
    const torrents = await searchTorrentsAnimeTosho(query);
    
    // Batch pack'leri filtrele - sadece tekil bölümleri göster
    const singleEpisodes = torrents.filter(t => {
      const title = t.title;
      
      console.log(chalk.gray(`🔍 Checking: ${title.substring(0, 60)}...`));
      
      // Batch pack patternleri - daha spesifik olmalı
      const batchPatterns = [
        /\d{1,3}-\d{2,3}/,           // "01-12", "1-24" (aralık - en az 2 haneli son)
        /\d{1,3}~\d{2,3}/,           // "01~12"
        /batch/i,                     // "batch" kelimesi
        /complete/i,                  // "complete" kelimesi
      ];
      
      // Eğer batch pattern varsa, bu batch pack'tir - atla
      const isBatch = batchPatterns.some(pattern => pattern.test(title));
      if (isBatch) {
        console.log(chalk.red(`  ❌ Batch pack filtered`));
        return false;
      }
      
      // Tekil bölüm patternleri (daha esnek)
      const singlePatterns = [
        /\s-\s0*\d{1,3}(?:\s|\[|\(|\.|$)/i,    // " - 01 ", " - 1", " - 01["
        /\sep\.?\s?0*\d{1,3}(?:\s|\[|\(|\.|$)/i, // "ep 01", "ep.01", "ep01"
        /\sepisode\s?0*\d{1,3}(?:\s|\[|\(|\.|$)/i, // "episode 01"
        /\se0*\d{1,3}(?:\s|\[|\(|\.|$)/i,      // "E01", "e01", "E1"
        /\[0*\d{1,3}\]/,                         // "[01]", "[1]"
        /\(0*\d{1,3}\)/,                         // "(01)", "(1)"
        /s\d{1,2}e\d{1,3}/i,                     // "S01E01", "S1E1"
        /\s\d{1,3}\s*\[/,                        // " 01 [", " 1 ["
        /\s\d{1,3}\s*\(/,                        // " 01 (", " 1 ("
      ];
      
      // Eğer tekil pattern varsa, bu tekil bölümdür
      const isSingle = singlePatterns.some(pattern => {
        const match = pattern.test(title);
        if (match) {
          console.log(chalk.green(`  ✅ Single episode matched: ${pattern}`));
        }
        return match;
      });
      
      if (!isSingle) {
        console.log(chalk.yellow(`  ⚠️ No single pattern matched`));
      }
      
      return isSingle;
    });
    
    console.log(chalk.green(`🎯 Found ${singleEpisodes.length} single episodes (filtered from ${torrents.length} total)`));
    
    res.json({ success: true, data: singleEpisodes });
  } catch (error) {
    console.error(chalk.red('MKV search error:'), error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Attachment'tan altyazı indir (AnimeTosho)
router.post('/subtitles/extract', async (req, res) => {
  try {
    const { attachmentUrl } = req.body;
    
    if (!attachmentUrl) {
      return res.status(400).json({ success: false, message: 'Attachment URL gerekli!' });
    }
    
    console.log(chalk.blue('📎 Downloading subtitles from:'), attachmentUrl);
    
    // AnimeTosho'dan .7z dosyasını indir
    const response = await fetch(attachmentUrl);
    
    if (!response.ok) {
      throw new Error('Attachment indirilemedi');
    }
    
    const buffer = await response.arrayBuffer();
    console.log(chalk.green('✅ Attachment indirildi:'), buffer.byteLength, 'bytes');
    
    // TODO: .7z dosyasını aç ve SRT dosyalarını çıkart
    // Şu an için basit response
    
    res.json({
      success: true,
      message: 'Attachment indirildi! SRT dosyaları manuel olarak yükleyin.',
      data: {
        downloadUrl: attachmentUrl,
        size: buffer.byteLength
      }
    });
    
  } catch (error) {
    console.error(chalk.red('Extract subtitle error:'), error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Upload subtitle file
router.post('/subtitles/upload', authMiddleware, adminMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Dosya yüklenemedi' });
    }
    
    const { animeId, episodeNumber, language } = req.body;
    
    if (!animeId || !episodeNumber || !language) {
      return res.status(400).json({ success: false, message: 'AnimeId, episodeNumber ve language gerekli' });
    }
    
    const fileUrl = `/uploads/subtitles/${req.file.filename}`;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    
    await dbRun(`
      INSERT OR REPLACE INTO subtitles 
      (anime_id, episode_number, language, file_name, storage_url, file_type, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [animeId, episodeNumber, language, req.file.originalname, fileUrl, fileExt, req.userId]);
    
    console.log(chalk.green(`✅ Altyazı yüklendi: ${req.file.originalname}`));
    
    res.json({ 
      success: true, 
      message: 'Altyazı başarıyla yüklendi!',
      data: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        url: fileUrl,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error(chalk.red('Subtitle upload error:'), error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/subtitles/add', async (req, res) => {
  try {
    const { animeId, episodeNumber, language, fileName, storageUrl } = req.body;
    
    if (!animeId || !episodeNumber || !language || !storageUrl) {
      return res.status(400).json({ success: false, message: 'Tüm alanlar gerekli!' });
    }
    
    const fileExt = path.extname(fileName || storageUrl).toLowerCase();
    
    await dbRun(`
      INSERT OR REPLACE INTO subtitles 
      (anime_id, episode_number, language, file_name, storage_url, file_type, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [animeId, episodeNumber, language, fileName, storageUrl, fileExt, req.userId]);
    
    res.json({ success: true, message: `${language} altyazı başarıyla eklendi!` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/subtitles/:animeId/:episodeNumber', async (req, res) => {
  try {
    const subtitles = await dbAll(`
      SELECT s.*, u.username as uploaded_by_username
      FROM subtitles s
      LEFT JOIN users u ON s.uploaded_by = u.id
      WHERE s.anime_id = ? AND s.episode_number = ?
      ORDER BY s.language ASC
    `, [req.params.animeId, req.params.episodeNumber]);
    res.json({ success: true, data: subtitles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/subtitles/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM subtitles WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Altyazı silindi' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/* ANIME SEARCH */
router.get('/anime/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ success: false, message: 'Arama terimi gerekli' });
    }
    
    const graphqlQuery = `
      query ($search: String) {
        Page(page: 1, perPage: 20) {
          media(search: $search, type: ANIME) {
            id
            title { romaji english }
            episodes
            coverImage { large extraLarge }
            format status
          }
        }
      }
    `;
    
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery, variables: { search: query } })
    });
    
    const data = await response.json();
    res.json({ success: true, data: data.data.Page.media });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/* STATISTICS */
router.get('/stats', async (req, res) => {
  try {
    const stats = {
      totalUsers: (await dbGet('SELECT COUNT(*) as count FROM users')).count,
      totalAdmins: (await dbGet('SELECT COUNT(*) as count FROM admin_users')).count,
      total4KEpisodes: (await dbGet('SELECT COUNT(*) as count FROM episodes_4k')).count,
      totalSubtitles: (await dbGet('SELECT COUNT(*) as count FROM subtitles')).count,
      totalWatchTime: (await dbGet('SELECT SUM(watch_time) as total FROM watch_history')).total || 0,
      totalComments: (await dbGet('SELECT COUNT(*) as count FROM comments')).count
    };
    
    const top4KAnime = await dbAll(`
      SELECT 
        e.anime_id, e.anime_title,
        COUNT(*) as episode_count,
        SUM(CAST(REPLACE(REPLACE(e.file_size, 'GB', ''), 'MB', '0.001') AS REAL)) as total_size_gb
      FROM episodes_4k e
      GROUP BY e.anime_id
      ORDER BY episode_count DESC
      LIMIT 10
    `);
    
    stats.top4KAnime = top4KAnime;
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
