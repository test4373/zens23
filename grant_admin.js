import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('./zenshin.db');

db.run(
  'INSERT OR REPLACE INTO admin_users (user_id, granted_by, permissions) VALUES (?, ?, ?)',
  [4, 4, 'all'],
  function(err) {
    if (err) {
      console.error('❌ Error:', err.message);
    } else {
      console.log('✅ Admin yetkisi verildi! User ID: 4 (UZS)');
      
      // Verify
      db.all('SELECT * FROM admin_users', (err, rows) => {
        if (!err) {
          console.log('📋 Current admins:', rows);
        }
        db.close();
      });
    }
  }
);
