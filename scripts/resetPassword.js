import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../zenshin.db');

const db = new sqlite3.Database(dbPath);

const username = process.argv[2];
const newPassword = process.argv[3];

if (!username || !newPassword) {
  console.log(chalk.red('❌ Kullanıcı adı ve yeni şifre gerekli!'));
  console.log(chalk.yellow('Kullanım: npm run reset-password <username> <new-password>'));
  process.exit(1);
}

async function resetPassword() {
  console.log(chalk.blue(`🔧 Resetting password for "${username}"...`));
  
  // Kullanıcıyı bul
  db.get('SELECT id, username FROM users WHERE username = ?', [username], async (err, user) => {
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
    
    // Şifreyi hashle
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Şifreyi güncelle
    db.run(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, user.id],
      (err) => {
        if (err) {
          console.error(chalk.red('Error updating password:'), err);
        } else {
          console.log(chalk.green(`✅ Password reset successfully for "${user.username}"!`));
          console.log(chalk.cyan(`\n🔐 New credentials:`));
          console.log(chalk.cyan(`   Username: ${username}`));
          console.log(chalk.cyan(`   Password: ${newPassword}`));
          console.log(chalk.yellow(`\n⚠️  Please login again with new password!\n`));
        }
        db.close();
      }
    );
  });
}

resetPassword();
