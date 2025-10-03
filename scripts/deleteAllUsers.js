import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../zenshin.db');

const db = new sqlite3.Database(dbPath);

async function deleteAllUsers() {
  console.log(chalk.yellow('⚠️  WARNING: This will delete ALL users and their data!'));
  console.log(chalk.blue('🗑️  Deleting all users...'));
  
  // Tüm kullanıcıları sil
  db.run('DELETE FROM users', (err) => {
    if (err) {
      console.error(chalk.red('Error deleting users:'), err);
      db.close();
      return;
    }
    
    console.log(chalk.green('✅ All users deleted!'));
    
    // Admin tablosunu da temizle
    db.run('DELETE FROM admin_users', (err) => {
      if (err) {
        console.error(chalk.red('Error deleting admins:'), err);
      } else {
        console.log(chalk.green('✅ All admin records deleted!'));
      }
      
      // Watch history temizle
      db.run('DELETE FROM watch_history', (err) => {
        if (err) {
          console.error(chalk.red('Error deleting watch history:'), err);
        } else {
          console.log(chalk.green('✅ All watch history deleted!'));
        }
        
        // Comments temizle
        db.run('DELETE FROM comments', (err) => {
          if (err) {
            console.error(chalk.red('Error deleting comments:'), err);
          } else {
            console.log(chalk.green('✅ All comments deleted!'));
          }
          
          console.log(chalk.cyan('\n🎉 Database cleaned! You can now register a new account.\n'));
          db.close();
        });
      });
    });
  });
}

deleteAllUsers();
