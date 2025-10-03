import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import AdmZip from 'adm-zip';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const playersDir = path.join(__dirname, 'players');

// Create players directory
if (!fs.existsSync(playersDir)) {
  fs.mkdirSync(playersDir, { recursive: true });
}

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

// Download file helper
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    
    console.log(chalk.cyan('📥 Downloading:'), url);
    
    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      
      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;
      
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const percent = ((downloaded / totalSize) * 100).toFixed(1);
        process.stdout.write(`\r  Progress: ${percent}%`);
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log('\n' + chalk.green('✅ Download complete'));
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// Extract ZIP
function extractZip(zipPath, extractTo) {
  console.log(chalk.cyan('📦 Extracting:'), path.basename(zipPath));
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractTo, true);
  console.log(chalk.green('✅ Extracted to:'), extractTo);
}

// Install MPV
async function installMPV() {
  console.log(chalk.blue('\n=== Installing MPV ==='));
  
  if (isWindows) {
    // Download MPV Windows build
    const mpvUrl = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/latest/download/mpv-x86_64-20240101-git-2b49cfe.7z';
    const mpvZip = path.join(playersDir, 'mpv.7z');
    const mpvExtractDir = path.join(playersDir, 'mpv');
    
    try {
      // For now, direct user to install manually
      console.log(chalk.yellow('⚠️  Windows: MPV otomatik kurulum desteklenmiyor'));
      console.log(chalk.cyan('📝 Manuel kurulum:'));
      console.log(chalk.cyan('   1. choco install mpv'));
      console.log(chalk.cyan('   2. https://mpv.io/installation/ adresinden indir'));
      console.log(chalk.cyan('   3. mpv.exe dosyasını PATH\'e ekle'));
      return false;
    } catch (error) {
      console.error(chalk.red('❌ MPV installation failed:'), error.message);
      return false;
    }
  } else if (isLinux) {
    // Try to install via package manager
    try {
      console.log(chalk.cyan('🔧 Installing MPV via apt...'));
      await execAsync('sudo apt install -y mpv');
      console.log(chalk.green('✅ MPV installed successfully'));
      return true;
    } catch (error) {
      console.log(chalk.yellow('⚠️  Auto-install failed. Please run:'));
      console.log(chalk.cyan('   sudo apt install mpv'));
      return false;
    }
  }
}

// Install VLC
async function installVLC() {
  console.log(chalk.blue('\n=== Installing VLC ==='));
  
  if (isWindows) {
    console.log(chalk.yellow('⚠️  Windows: VLC otomatik kurulum desteklenmiyor'));
    console.log(chalk.cyan('📝 Manuel kurulum:'));
    console.log(chalk.cyan('   1. choco install vlc'));
    console.log(chalk.cyan('   2. https://www.videolan.org/vlc/ adresinden indir'));
    return false;
  } else if (isLinux) {
    try {
      console.log(chalk.cyan('🔧 Installing VLC via apt...'));
      await execAsync('sudo apt install -y vlc');
      console.log(chalk.green('✅ VLC installed successfully'));
      return true;
    } catch (error) {
      console.log(chalk.yellow('⚠️  Auto-install failed. Please run:'));
      console.log(chalk.cyan('   sudo apt install vlc'));
      return false;
    }
  }
}

// Check if players are installed
async function checkPlayers() {
  console.log(chalk.blue('\n=== Checking Installed Players ==='));
  
  // Check FFmpeg
  try {
    const ffmpegResult = await execAsync('ffmpeg -version');
    console.log(chalk.green('✅ FFmpeg is installed'));
  } catch (error) {
    console.log(chalk.red('❌ FFmpeg NOT installed - REQUIRED for subtitles!'));
    console.log(chalk.yellow('Install with:'));
    if (isWindows) {
      console.log(chalk.cyan('   choco install ffmpeg'));
    } else if (isLinux) {
      console.log(chalk.cyan('   sudo apt install ffmpeg'));
    }
  }
  
  // Check MPV
  try {
    await execAsync('mpv --version');
    console.log(chalk.green('✅ MPV is installed'));
  } catch (error) {
    console.log(chalk.yellow('⚠️  MPV not installed (optional)'));
    return false;
  }
  
  // Check VLC
  try {
    if (isWindows) {
      await execAsync('vlc --version');
    } else {
      await execAsync('vlc --version');
    }
    console.log(chalk.green('✅ VLC is installed'));
  } catch (error) {
    console.log(chalk.yellow('⚠️  VLC not installed (optional)'));
    return false;
  }
  
  return true;
}

// Main installation
async function main() {
  console.log(chalk.bold.blue('╔════════════════════════════════════════╗'));
  console.log(chalk.bold.blue('║   Zenshin Media Players Installer     ║'));
  console.log(chalk.bold.blue('╚════════════════════════════════════════╝\n'));
  
  console.log(chalk.cyan('Platform:'), process.platform);
  console.log(chalk.cyan('Architecture:'), process.arch);
  
  const allInstalled = await checkPlayers();
  
  if (allInstalled) {
    console.log(chalk.green('\n✅ All players are installed!'));
    process.exit(0);
  }
  
  console.log(chalk.yellow('\n⚠️  Some players are missing'));
  console.log(chalk.cyan('Attempting auto-installation...\n'));
  
  if (isLinux) {
    await installMPV();
    await installVLC();
  } else {
    console.log(chalk.yellow('\n⚠️  Automatic installation not supported on Windows'));
    console.log(chalk.cyan('Please install manually:'));
    console.log(chalk.cyan('   choco install ffmpeg mpv vlc'));
    console.log(chalk.cyan('   OR download from official websites'));
  }
  
  console.log(chalk.blue('\n=== Installation Summary ==='));
  await checkPlayers();
}

main().catch(err => {
  console.error(chalk.red('Installation error:'), err);
  process.exit(1);
});
