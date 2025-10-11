import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SQLite database dosyasını oluştur - Render.com için /tmp kullan (yazılabilir)
const dbPath = path.join(process.env.TMPDIR || process.env.TEMP || '/tmp', 'zenshin.db');

// Database bağlantısı
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error(chalk.red('Database connection error:'), err);
  } else {
    console.log(chalk.green('✓ Database connected successfully'));
    initializeDatabase();
  }
});

// Database tablolarını oluştur
function initializeDatabase() {
  // Kullanıcılar tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT '/zenshin/default-avatar.png',
      bio TEXT DEFAULT '',
      banner TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating users table:'), err);
    else console.log(chalk.green('✓ Users table ready'));
  });

  // İzleme geçmişi tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS watch_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      anime_id TEXT NOT NULL,
      anime_title TEXT NOT NULL,
      anime_image TEXT,
      episode_number INTEGER,
      magnet_uri TEXT,
      last_watched DATETIME DEFAULT CURRENT_TIMESTAMP,
      progress REAL DEFAULT 0,
      watch_time INTEGER DEFAULT 0,
      status TEXT DEFAULT 'watching',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, anime_id, episode_number, magnet_uri)
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating watch_history table:'), err);
    else {
      console.log(chalk.green('✓ Watch history table ready'));
      
      // Add magnet_uri column if it doesn't exist (migration)
      db.run(`ALTER TABLE watch_history ADD COLUMN magnet_uri TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error(chalk.yellow('Note: magnet_uri column may already exist'));
        }
      });
      
      // Add watch_time column if it doesn't exist (migration)
      db.run(`ALTER TABLE watch_history ADD COLUMN watch_time INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error(chalk.yellow('Note: watch_time column may already exist'));
        }
      });
      
      // Add current_time column for second-based progress (migration)
      db.run(`ALTER TABLE watch_history ADD COLUMN current_time REAL DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error(chalk.yellow('Note: current_time column may already exist'));
        } else {
          console.log(chalk.green('✓ current_time column ready (second-based progress)'));
        }
      });
      
      // Clean up duplicate entries (keep only the latest)
      db.run(`
        DELETE FROM watch_history 
        WHERE id NOT IN (
          SELECT MAX(id) 
          FROM watch_history 
          GROUP BY user_id, anime_id, episode_number, magnet_uri
        )
      `, (err) => {
        if (err) {
          console.error(chalk.red('Error cleaning duplicates:'), err);
        } else {
          console.log(chalk.green('✓ Duplicate watch history entries cleaned'));
        }
      });
    }
  });

  // Tamamlanan animeler tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS completed_anime (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      anime_id TEXT NOT NULL,
      anime_title TEXT NOT NULL,
      anime_image TEXT,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      rating INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, anime_id)
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating completed_anime table:'), err);
    else console.log(chalk.green('✓ Completed anime table ready'));
  });

  // Favoriler tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      anime_id TEXT NOT NULL,
      anime_title TEXT NOT NULL,
      anime_image TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, anime_id)
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating favorites table:'), err);
    else console.log(chalk.green('✓ Favorites table ready'));
  });

  // Kullanıcı oturum tablosu (güvenlik için)
  db.run(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating user_sessions table:'), err);
    else console.log(chalk.green('✓ User sessions table ready'));
  });

  // Başarısız giriş denemeleri tablosu (brute force koruması)
  db.run(`
    CREATE TABLE IF NOT EXISTS failed_login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating failed_login_attempts table:'), err);
    else console.log(chalk.green('✓ Failed login attempts table ready'));
  });

  // Admin yetkisi tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      granted_by INTEGER,
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      permissions TEXT DEFAULT 'all',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (granted_by) REFERENCES users(id)
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating admin_users table:'), err);
    else console.log(chalk.green('✓ Admin users table ready'));
  });

  // 4K Episodes tablosu (MEGA/Drive linkler)
  db.run(`
    CREATE TABLE IF NOT EXISTS episodes_4k (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id TEXT NOT NULL,
      anime_title TEXT NOT NULL,
      episode_number INTEGER NOT NULL,
      storage_type TEXT DEFAULT 'mega',
      storage_url TEXT NOT NULL,
      file_size TEXT,
      quality TEXT DEFAULT '4K',
      upscaled_by INTEGER,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (upscaled_by) REFERENCES users(id),
      UNIQUE(anime_id, episode_number)
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating episodes_4k table:'), err);
    else console.log(chalk.green('✓ 4K Episodes table ready'));
  });

  // Altyazı dosyaları tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS subtitles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id TEXT NOT NULL,
      episode_number INTEGER NOT NULL,
      language TEXT NOT NULL,
      file_name TEXT NOT NULL,
      storage_url TEXT NOT NULL,
      file_type TEXT DEFAULT '.srt',
      uploaded_by INTEGER,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by) REFERENCES users(id),
      UNIQUE(anime_id, episode_number, language)
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating subtitles table:'), err);
    else {
      console.log(chalk.green('✓ Subtitles table ready'));
      
      // Add file_type column if it doesn't exist (migration)
      db.run(`ALTER TABLE subtitles ADD COLUMN file_type TEXT DEFAULT '.srt'`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error(chalk.yellow('Note: file_type column may already exist'));
        }
      });
    }
  });

  // Yorumlar tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      anime_id TEXT,
      content TEXT NOT NULL,
      parent_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating comments table:'), err);
    else console.log(chalk.green('✓ Comments table ready'));
  });

  // Etiketler/Mentions tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      mentioned_user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (mentioned_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating mentions table:'), err);
    else console.log(chalk.green('✓ Mentions table ready'));
  });

  // Beğeniler tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS comment_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      comment_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      UNIQUE(user_id, comment_id)
    )
  `, (err) => {
    if (err) console.error(chalk.red('Error creating comment_likes table:'), err);
    else console.log(chalk.green('✓ Comment likes table ready'));
  });
}

// Database işlemleri için yardımcı fonksiyonlar
export const dbGet = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export const dbRun = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

export default db;
