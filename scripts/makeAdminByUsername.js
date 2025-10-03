import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../zenshin.db');

const db = new sqlite3.Database(dbPath);

const username = process.argv[2];

if (!username) {
  console.log(chalk.red('❌ Kullanıcı adı gerekli!'));
  console.log(chalk.yellow('Kullanım: npm run make-admin <username>'));
  process.exit(1);
}

async function makeAdmin() {
  console.log(chalk.blue(`🔧 Making "${username}" admin...`));
  
  // Kullanıcıyı bul
  db.get('SELECT id, username FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      console.error(chalk.red('Error fetching user:'), err);
      db.close();
      return;
    }
    
    if (!user) {
      console.log(chalk.red(`❌ Kullanıcı "${username}" bulunamadı!`));
      db.close();
      return;
    }
    
    // Admin kontrolü
    db.get('SELECT * FROM admin_users WHERE user_id = ?', [user.id], (err, admin) => {
      if (err) {
        console.error(chalk.red('Error checking admin:'), err);
        db.close();
        return;
      }
      
      if (admin) {
        console.log(chalk.yellow(`⚠️ User "${user.username}" (ID: ${user.id}) is already an admin!`));
        db.close();
        return;
      }
      
      // Admin yap
      db.run(
        'INSERT INTO admin_users (user_id, granted_by, permissions) VALUES (?, ?, ?)',
        [user.id, user.id, 'all'],
        (err) => {
          if (err) {
            console.error(chalk.red('Error creating admin:'), err);
          } else {
            console.log(chalk.green(`✅ User "${user.username}" (ID: ${user.id}) is now an admin!`));
            console.log(chalk.cyan('\n🔐 Admin Secret Password: ZenshinAdmin@2024!PowerMode'));
            console.log(chalk.cyan('💡 Type this in the search bar to access admin panel\n'));
          }
          db.close();
        }
      );
    });
  });
}

makeAdmin();
