import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('./zenshin.db');

db.run(
  "UPDATE users SET avatar = '/zenshin/default-avatar.png' WHERE avatar = '/default-avatar.png' OR avatar IS NULL OR avatar = ''",
  function(err) {
    if (err) {
      console.error('❌ Error:', err.message);
    } else {
      console.log('✅ Updated', this.changes, 'user avatar(s)');
      
      // Verify
      db.all('SELECT id, username, avatar FROM users', (err, rows) => {
        if (!err) {
          console.log('📋 Users:', rows);
        }
        db.close();
      });
    }
  }
);
