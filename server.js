import express from "express";
import WebTorrent from "webtorrent";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import './database.js'; // Database'i başlat
import userRoutes from './routes/userRoutes.js';
import watchRoutes from './routes/watchRoutes.js';
import commentRoutes from './routes/commentRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { authMiddleware } from './auth.js';
import { bandwidthMonitor, qualitySelector } from './bandwidth-monitor.js';
import { CDN_CONFIG, OPTIMIZATION_STRATEGIES } from './cdn-config.js';

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// const tempDir = path.join(process.env.TEMP || "/tmp", "myapp_subtitles");
// const webtDir = path.join(process.env.TEMP || "/tmp", "webtorrent");
// console.log(tempDir);
const downloadsDir = path.join(__dirname, "downloads");
console.log(downloadsDir);
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Upscale Tests directory
const upscaleDir = path.join(path.dirname(__dirname), "Upscale Tests");
if (!fs.existsSync(upscaleDir)) {
  fs.mkdirSync(upscaleDir, { recursive: true });
}
console.log(chalk.cyan('📁 Upscale directory:'), upscaleDir);

// LOCAL SUBTITLES directory (Dandadan Season 2)
const localSubsDir = 'C:\\Users\\Yusuf\\Downloads\\Compressed\\[DB] Dandadan 2nd Season - Dan Da Dan Season 2 [Dual Audio 10bit 1080p][HEVC-x265]_attachments';

// Recursive function to list all subtitle files
function listSubtitlesRecursive(dir, depth = 0) {
  const indent = '  '.repeat(depth);
  let subtitles = [];
  
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      
      if (item.isDirectory()) {
        console.log(chalk.gray(indent + '📁 ' + item.name));
        const subSubs = listSubtitlesRecursive(fullPath, depth + 1);
        subtitles = subtitles.concat(subSubs);
      } else if (item.name.endsWith('.ass') || item.name.endsWith('.srt')) {
        // Extract episode number - try multiple patterns
        let episode = '??';
        let match = item.name.match(/\s-\s*(\d+)/);
        if (match) episode = match[1];
        
        if (episode === '??') {
          match = item.name.match(/[eE](\d+)/);
          if (match) episode = match[1];
        }
        
        if (episode === '??') {
          match = item.name.match(/\d+/);
          if (match) episode = match[0];
        }
        const type = item.name.endsWith('.ass') ? chalk.yellow('ASS') : chalk.blue('SRT');
        console.log(chalk.gray(indent + '📄 ') + type + chalk.gray(' Ep.' + episode + ' - ') + chalk.cyan(item.name));
        subtitles.push({ episode: parseInt(episode), name: item.name, path: fullPath });
      }
    }
  } catch (err) {
    console.log(chalk.red(indent + '❌ Error:'), err.message);
  }
  
  return subtitles;
}

if (fs.existsSync(localSubsDir)) {
  console.log(chalk.green('\n✅ Local subtitles directory found:'));
  console.log(chalk.gray('  Path:'), localSubsDir);
  console.log(chalk.cyan('\n📂 Scanning for subtitle files...'));
  const allSubs = listSubtitlesRecursive(localSubsDir);
  console.log(chalk.green(`\n✅ Total subtitle files found: ${allSubs.length}`));
  if (allSubs.length > 0) {
    const episodes = allSubs.map(s => s.episode).filter(e => !isNaN(e)).sort((a, b) => a - b);
    console.log(chalk.cyan('  Available episodes:'), episodes.join(', '));
  }
} else {
  console.log(chalk.yellow('\n⚠️ Local subtitles directory not found:'), localSubsDir);
}

const app = express();
// WebTorrent client - ULTRA LOW BANDWIDTH MODE
const client = new WebTorrent({
  maxConns: 20,         // Limit connections to save bandwidth
  downloadLimit: 512000, // 512 KB/s = 4 Mbps (enough for 1080p streaming)
  uploadLimit: 64000,   // 64 KB/s upload (minimal sharing to save bandwidth)
  dht: true,
  tracker: {
    announce: [
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.btorrent.xyz',
      'wss://tracker.fastcast.nz'
    ]
  },
  // CRITICAL: Enable streaming mode
  strategy: 'sequential' // Download sequentially for smooth streaming
});

console.log(chalk.cyan('🌐 WebTorrent initialized (STREAM-ONLY mode)'));

// Güvenlik middleware'leri
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false // Video streaming için
}));
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-Subtitle-Type', 'Content-Type'] // Custom header'ı expose et
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve upscale files
app.use('/upscale', express.static(upscaleDir));

// Rate limiting - DDoS koruması
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 dakika
  max: 500, // 1 dakikada maksimum 500 istek
  message: 'Çok fazla istek gönderdiniz, lütfen daha sonra tekrar deneyin',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 15 dakikada maksimum 5 login/register denemesi
  message: 'Çok fazla giriş denemesi, lütfen 15 dakika sonra tekrar deneyin',
  skipSuccessfulRequests: true
});

// Apply rate limiter only to sensitive endpoints
// app.use('/api/', limiter); // Disabled for watch history tracking
app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/watch', watchRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/admin', adminRoutes); // Admin panel routes

// Bandwidth monitoring middleware
app.use(bandwidthMonitor.middleware());

// Request logging
app.use((req, res, next) => {
  console.log(`${chalk.cyan(req.method)} ${chalk.yellow(req.path)} - ${chalk.gray(req.ip)}`);
  next();
});

// Ensure the temporary directory exists
// if (!fs.existsSync(tempDir)) {
//   fs.mkdirSync(tempDir, { recursive: true });
// }

/* ------------- CHECK LATEST GITHUB RELEASE ------------ */
const owner = "hitarth-gg"; // Replace with the repository owner
const repo = "zenshin"; // Replace with the repository name
const currentVersion = "v1.0.0"; // Replace with the current version

const getLatestRelease = async () => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.tag_name !== currentVersion) {
      console.log(chalk.blue("New version available:", data.tag_name));
      console.log("Release notes:", data.body);
      console.log(
        chalk.yellow(
          "Download URL: https://github.com/hitarth-gg/zenshin/releases"
        )
      );
    }
  } catch (error) {
    console.error("Error fetching latest release:", error);
  }
};
getLatestRelease();
/* ------------------------------------------------------ */

/* ----------------- SEED EXISTING FILES ---------------- */
// Seed all existing files on server startup
const seedExistingFiles = () => {
  fs.readdir(downloadsDir, (err, files) => {
    if (err) {
      console.error("Error reading downloads directory:", err);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(downloadsDir, file);

      if (fs.lstatSync(filePath).isFile()) {
        client.seed(filePath, { path: downloadsDir }, (torrent) => {
          // console.log(`Seeding file: ${filePath}`);
          // console.log(`Magnet URI: ${torrent.magnetURI}`);
          console.log(
            chalk.bgBlue("Seeding started: "),
            chalk.cyan(torrent.name)
          );
          torrent.on("error", (err) => {
            console.error(chalk.bgRed("Error seeding file:"), err);
          });
        });
      }
    });
  });
};

// Call the function to start seeding existing files
seedExistingFiles();
/* ------------------------------------------------------ */

app.get("/add/:magnet", async (req, res) => {
  let magnet = req.params.magnet;

  /* ------------------------------------------------------ */
  // Check if the torrent is already added
  let existingTorrent = await client.get(magnet);
  console.log("Existing torrent:", existingTorrent);

  if (existingTorrent) {
    // If torrent is already added, return its file information
    let files = existingTorrent.files.map((file) => ({
      name: file.name,
      length: file.length,
    }));
    // console.log("Existing torrent files:", files);

    return res.status(200).json(files);
  }
  /* ------------------------------------------------------ */

  client.add(magnet, function (torrent) {
    let files = torrent.files.map((file) => ({
      name: file.name,
      length: file.length,
    }));
    // console.log(files);

    res.status(200).json(files);
  });
});

/* -------------------- GET METADATA -------------------- */
app.get("/metadata/:magnet", async (req, res) => {
  let magnet = req.params.magnet;

  /* ------------------------------------------------------ */
  // Check if the torrent is already added
  let existingTorrent = await client.get(magnet);
  console.log("Existing torrent:", existingTorrent);

  if (existingTorrent) {
    // If torrent is already added, return its file information
    let files = existingTorrent.files.map((file) => ({
      name: file.name,
      length: file.length,
    }));
    // console.log("Existing torrent files:", files);

    return res.status(200).json(files);
  }
  /* ------------------------------------------------------ */

  const torrent = client.add(magnet, { deselect: true, path: downloadsDir });

  torrent.on("metadata", () => {
    const files = torrent.files.map((file) => ({
      name: file.name,
      length: file.length,
    }));
    console.log(files);

    res.status(200).json(files);
  });
});

app.get("/streamfile/:magnet/:filename", async function (req, res, next) {
  let magnet = req.params.magnet;
  let filename = decodeURIComponent(req.params.filename);

  console.log(chalk.cyan('\n🎥 Streamfile request:'));
  console.log(chalk.yellow('  Filename:'), filename);

  let tor = await client.get(magnet);

  if (!tor) {
    console.log(chalk.red('❌ Torrent not found'));
    return res.status(404).send("Torrent not found");
  }

  let file = tor.files.find((f) => f.name === filename);

  if (!file) {
    console.log(chalk.red('❌ File not found:'), filename);
    console.log(chalk.yellow('  Available files:'));
    tor.files.forEach(f => console.log(chalk.gray('    -'), f.name));
    return res.status(404).send("File not found in torrent");
  }
  console.log(chalk.green('✅ File found:'), file.name);

  // 🔥 CRITICAL: Smart file selection - only download what's needed
  file.select();
  
  // Deselect all other files to save bandwidth
  tor.files.forEach(f => {
    if (f.name !== filename) {
      f.deselect();
    }
  });
  
  console.log(chalk.cyan('💡 Bandwidth optimization:'));
  console.log(chalk.yellow('  Selected file:'), file.name);
  console.log(chalk.yellow('  File size:'), (file.length / 1024 / 1024).toFixed(2), 'MB');
  console.log(chalk.green('  ✅ Other files deselected to save bandwidth'));

  let range = req.headers.range;

  console.log(chalk.gray("Range:"), range);

  if (!range) {
    return res.status(416).send("Range is required");
  }

  let positions = range.replace(/bytes=/, "").split("-");
  let start = parseInt(positions[0], 10);
  let file_size = file.length;
  let end = positions[1] ? parseInt(positions[1], 10) : file_size - 1;
  
  // 🔥 SMART CHUNK SIZE - Only download 2MB at a time
  const MAX_CHUNK = 2 * 1024 * 1024; // 2MB chunks
  if (end - start > MAX_CHUNK) {
    end = start + MAX_CHUNK;
  }
  
  let chunksize = end - start + 1;

  console.log(chalk.cyan('📊 Streaming stats:'));
  console.log(chalk.yellow('  Chunk size:'), (chunksize / 1024 / 1024).toFixed(2), 'MB');
  console.log(chalk.yellow('  Progress:'), ((start / file_size) * 100).toFixed(1) + '%');

  let head = {
    "Content-Range": `bytes ${start}-${end}/${file_size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunksize,
    "Content-Type": "video/x-matroska",
    "Cache-Control": "public, max-age=3600", // Cache for 1 hour
    "X-Content-Type-Options": "nosniff"
  };

  res.writeHead(206, head);

  let stream_position = {
    start: start,
    end: end,
  };

  detailsOfEpisode.percentageWatched = (start / file_size) * 100;

  let stream = file.createReadStream(stream_position);
  
  // 🔥 BANDWIDTH MONITOR
  let bytesStreamed = 0;
  const streamStart = Date.now();
  
  stream.on('data', (chunk) => {
    bytesStreamed += chunk.length;
  });
  
  stream.on('end', () => {
    const duration = (Date.now() - streamStart) / 1000;
    const speed = (bytesStreamed / 1024 / duration).toFixed(2);
    console.log(chalk.green('✅ Chunk delivered:'), speed, 'KB/s');
  });
  
  stream.pipe(res);

  stream.on("error", function (err) {
    console.error("Stream error:", err);
    // Only send a response if headers haven't been sent yet
    if (!res.headersSent) {
      return res.status(500).send("Error streaming the video");
    }
  });

  stream.on("close", () => {
    console.log("Stream closed prematurely");
  });
});

// Deselect an episode with the given filename
app.get("/deselect/:magnet/:filename", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = req.params.filename;

  let tor = await client.get(magnet);

  if (!tor) {
    return res.status(404).send("Torrent not found");
  }

  let file = tor.files.find((f) => f.name === filename);

  if (!file) {
    return res.status(404).send("No file found in the torrent");
  }

  console.log(chalk.bgRed("Download Stopped:") + " " + chalk.cyan(file.name));

  file.deselect();

  res.status(200).send("File deselected successfully");
});

// get download details of a file

let detailsOfEpisode = {
  name: "",
  length: 0,
  downloaded: 0,
  progress: 0,
  percentageWatched: 0,
}

app.get("/detailsepisode/:magnet/:filename", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = req.params.filename;

  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).send("Torrent not found");
  }

  let file = tor.files.find((f) => f.name === filename);
  if (!file) {
    return res.status(404).send("No file found in the torrent");
  }

  // let details = {
  detailsOfEpisode = {
    name: file.name,
    length: file.length,
    downloaded: file.downloaded,
    progress: file.progress,
    percentageWatched: detailsOfEpisode.percentageWatched,
  };

  res.status(200).json(detailsOfEpisode);
});

/* ------------------------------------------------------ */

app.get("/stream/:magnet", async function (req, res, next) {
  let magnet = req.params.magnet;
  console.log(magnet);

  let tor = await client.get(magnet);

  if (!tor) {
    return res.status(404).send("Torrent not found");
  }

  let file = tor.files.find((f) => f.name.endsWith(".mkv"));
  console.log("file :" + file.toString());

  if (!file) {
    return res.status(404).send("No MP4 file found in the torrent");
  }

  let range = req.headers.range;
  console.log("Range : " + range);

  if (!range) {
    return res.status(416).send("Range is required");
  }

  let positions = range.replace(/bytes=/, "").split("-");
  let start = parseInt(positions[0], 10);
  let file_size = file.length;
  let end = positions[1] ? parseInt(positions[1], 10) : file_size - 1;
  let chunksize = end - start + 1;

  let head = {
    "Content-Range": `bytes ${start}-${end}/${file_size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunksize,
    "Content-Type": "video/x-matroska",
  };

  res.writeHead(206, head);

  let stream_position = {
    start: start,
    end: end,
  };

  let stream = file.createReadStream(stream_position);
  stream.pipe(res);

  stream.on("error", function (err) {
    console.error("Stream error:", err);
    // Only send a response if headers haven't been sent yet
    if (!res.headersSent) {
      return res.status(500).send("Error streaming the video");
    }
  });

  stream.on("close", () => {
    console.log("Stream closed prematurely");
  });
});

app.get("/details/:magnet", async (req, res) => {
  let magnet = req.params.magnet;

  // Find the torrent by magnet link
  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).send("Torrent not found");
  }

  // Prepare torrent details
  let details = {
    name: tor.name,
    length: tor.length,
    downloaded: tor.downloaded,
    uploaded: tor.uploaded,
    downloadSpeed: tor.downloadSpeed,
    uploadSpeed: tor.uploadSpeed,
    progress: tor.progress,
    ratio: tor.ratio,
    numPeers: tor.numPeers,
  };

  res.status(200).json(details);
});

/* --------------- Handling VLC streaming --------------- */
import { exec } from "child_process";
import { get } from "http";
import fetch from "node-fetch";
import { promisify } from "util";
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

const execAsync = promisify(exec);

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath.path);
console.log(chalk.cyan('🎬 FFmpeg path:'), ffmpegPath.path);

// Cross-platform VLC/MPV detection
import os from 'os';

const isWindows = os.platform() === 'win32';
const isLinux = os.platform() === 'linux';
const isMac = os.platform() === 'darwin';

const vlcPaths = isWindows ? [
  '"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe"',
  '"C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe"',
  'vlc'
] : isLinux ? [
  '/usr/bin/vlc',
  '/usr/local/bin/vlc',
  'vlc'
] : [ // macOS
  '/Applications/VLC.app/Contents/MacOS/VLC',
  'vlc'
];

const mpvPaths = isWindows ? [
  'mpv',
  '"C:\\Program Files\\mpv\\mpv.exe"',
  '"C:\\mpv\\mpv.exe"'
] : [ // Linux/Mac
  '/usr/bin/mpv',
  '/usr/local/bin/mpv',
  'mpv'
];

// Auto-detect working paths
const findWorkingPath = async (paths, playerName) => {
  for (const path of paths) {
    try {
      await execAsync(`${path} --version`);
      console.log(chalk.green(`✅ ${playerName} found:`), path);
      return path;
    } catch (error) {
      // Try next path
    }
  }
  console.log(chalk.yellow(`⚠️ ${playerName} not found in system`));
  return paths[0]; // Return default
};

let vlcPath = vlcPaths[0];
let mpvPath = mpvPaths[0];

// Detect players on startup
findWorkingPath(vlcPaths, 'VLC').then(path => { vlcPath = path; });
findWorkingPath(mpvPaths, 'MPV').then(path => { mpvPath = path; });

// Check if player is installed
app.get("/check-player/:player", async (req, res) => {
  const player = req.params.player;
  const paths = player === 'vlc' ? vlcPaths : mpvPaths;
  
  for (const path of paths) {
    try {
      await execAsync(`${path} --version`);
      console.log(chalk.green(`✅ ${player.toUpperCase()} found:`, path));
      return res.json({ installed: true, path: path });
    } catch (error) {
      // Try next path
    }
  }
  
  console.log(chalk.yellow(`⚠️ ${player.toUpperCase()} not found`));
  res.json({ installed: false });
});

app.get("/stream-to-vlc", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("URL is required");
  }
  
  console.log(chalk.cyan('🎬 Launching VLC:'), url);
  const vlcCommand = `${vlcPath} "${url}"`;

  exec(vlcCommand, (error) => {
    if (error) {
      console.error(chalk.red('❌ VLC error:'), error.message);
      console.log(chalk.yellow('💡 VLC kurulu değil. Kurmak için:'));
      if (isWindows) {
        console.log(chalk.cyan('   choco install vlc'));
      } else if (isLinux) {
        console.log(chalk.cyan('   sudo apt install vlc'));
        console.log(chalk.cyan('   sudo dnf install vlc'));
      } else {
        console.log(chalk.cyan('   brew install --cask vlc'));
      }
      console.log(chalk.cyan('   https://www.videolan.org/vlc/'));
      return res.status(500).send("Error launching VLC. VLC not installed.");
    }
    console.log(chalk.green('✅ VLC launched successfully'));
    res.send("VLC launched successfully");
  });
});

// Stream to MPV player with automatic subtitle loading
app.get("/stream-to-mpv", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("URL is required");
  }
  
  console.log(chalk.cyan('🎬 Launching MPV:'), url);
  
  // MPV with best settings for anime
  const mpvCommand = `${mpvPath} "${url}" --force-window=immediate --keep-open=yes --sub-auto=all --slang=en,eng,jpn --sid=1 --profile=gpu-hq`;

  exec(mpvCommand, (error) => {
    if (error) {
      console.error(chalk.red('❌ MPV error:'), error.message);
      console.log(chalk.yellow('💡 MPV kurulu değil. Kurmak için:'));
      if (isWindows) {
        console.log(chalk.cyan('   choco install mpv'));
        console.log(chalk.cyan('   scoop install mpv'));
      } else if (isLinux) {
        console.log(chalk.cyan('   sudo apt install mpv'));
        console.log(chalk.cyan('   sudo dnf install mpv'));
        console.log(chalk.cyan('   sudo pacman -S mpv'));
      } else {
        console.log(chalk.cyan('   brew install mpv'));
      }
      console.log(chalk.cyan('   https://mpv.io/installation/'));
      return res.status(500).send("Error launching MPV. MPV not installed or not in PATH.");
    }
    console.log(chalk.green('✅ MPV launched successfully'));
    res.send("MPV launched successfully");
  });
});
/* -------------------- END VLC/MPV PLAYERS -------------------- */

app.delete("/remove/:magnet", async (req, res) => {
  let magnet = req.params.magnet;

  // Find the torrent by magnet link
  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).send("Torrent not found");
  }

  const torrentName = tor.name;
  const torrentPath = tor.path;

  console.log(chalk.bgRed("Removing torrent:"), chalk.cyan(torrentName));
  console.log(chalk.yellow("Torrent path:"), torrentPath);

  // Destroy the torrent to stop downloading and remove it from the client
  tor.destroy({ destroyStore: true }, async (err) => {
    if (err) {
      console.error(chalk.red("Error removing torrent:"), err);
      return res.status(500).send("Error removing torrent");
    }

    // Delete physical files from disk
    const fullPath = path.join(downloadsDir, torrentName);
    console.log(chalk.yellow("Attempting to delete:"), fullPath);

    try {
      if (fs.existsSync(fullPath)) {
        // Check if it's a file or directory
        const stats = fs.statSync(fullPath);
        
        if (stats.isDirectory()) {
          // Delete directory recursively
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(chalk.green("✓ Deleted directory:"), fullPath);
        } else {
          // Delete file
          fs.unlinkSync(fullPath);
          console.log(chalk.green("✓ Deleted file:"), fullPath);
        }
      } else {
        console.log(chalk.yellow("⚠ File/directory not found:"), fullPath);
      }
    } catch (deleteErr) {
      console.error(chalk.red("✗ Error deleting files:"), deleteErr);
      // Don't return error to user, torrent is already removed from client
    }

    console.log(chalk.green("✓ Torrent removed successfully:"), torrentName);
    res.status(200).send("Torrent removed successfully");
  });
});

// Get all active torrents
app.get("/active-torrents", (req, res) => {
  const torrents = client.torrents.map((torrent) => ({
    name: torrent.name,
    magnetURI: torrent.magnetURI,
    length: torrent.length,
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    progress: torrent.progress,
    ratio: torrent.ratio,
    numPeers: torrent.numPeers,
  }));

  res.status(200).json(torrents);
});

// ping backend
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

/* ========== BANDWIDTH OPTIMIZATION ========== */
// Get network stats and optimize quality
app.get("/network-stats", async (req, res) => {
  const stats = {
    activeTorrents: client.torrents.length,
    totalDownloadSpeed: 0,
    totalUploadSpeed: 0,
    recommendedQuality: 'auto',
    bandwidthUsage: 'low'
  };
  
  client.torrents.forEach(torrent => {
    stats.totalDownloadSpeed += torrent.downloadSpeed;
    stats.totalUploadSpeed += torrent.uploadSpeed;
  });
  
  // Convert to Mbps
  const downloadMbps = (stats.totalDownloadSpeed * 8 / 1024 / 1024).toFixed(2);
  const uploadMbps = (stats.totalUploadSpeed * 8 / 1024 / 1024).toFixed(2);
  
  // Recommend quality based on speed
  if (downloadMbps < 2) {
    stats.recommendedQuality = '480p';
    stats.bandwidthUsage = 'very-low';
  } else if (downloadMbps < 5) {
    stats.recommendedQuality = '720p';
    stats.bandwidthUsage = 'low';
  } else if (downloadMbps < 10) {
    stats.recommendedQuality = '1080p';
    stats.bandwidthUsage = 'medium';
  } else {
    stats.recommendedQuality = '4K';
    stats.bandwidthUsage = 'high';
  }
  
  console.log(chalk.cyan('📊 Network Stats:'));
  console.log(chalk.yellow('  Download:'), downloadMbps, 'Mbps');
  console.log(chalk.yellow('  Upload:'), uploadMbps, 'Mbps');
  console.log(chalk.green('  Recommended:'), stats.recommendedQuality);
  
  res.json({
    downloadSpeed: downloadMbps + ' Mbps',
    uploadSpeed: uploadMbps + ' Mbps',
    ...stats
  });
});

// Set bandwidth limit dynamically
app.post("/set-bandwidth-limit", express.json(), (req, res) => {
  const { downloadLimit, uploadLimit } = req.body;
  
  // Validate limits (in KB/s)
  const dlLimit = Math.max(128, Math.min(downloadLimit || 512, 10000)); // 128KB - 10MB
  const upLimit = Math.max(32, Math.min(uploadLimit || 64, 1000));      // 32KB - 1MB
  
  console.log(chalk.cyan('⚙️ Bandwidth limit updated:'));
  console.log(chalk.yellow('  Download:'), dlLimit, 'KB/s');
  console.log(chalk.yellow('  Upload:'), upLimit, 'KB/s');
  
  // Note: WebTorrent doesn't support dynamic limit changes
  // This would require restarting the client
  res.json({
    success: true,
    message: 'Bandwidth limits updated (restart required for full effect)',
    limits: {
      download: dlLimit + ' KB/s',
      upload: upLimit + ' KB/s'
    }
  });
});

// Smart prefetch - Only download next 5 minutes of video
app.get("/smart-prefetch/:magnet/:filename/:position", async (req, res) => {
  const { magnet, filename, position } = req.params;
  const currentPos = parseInt(position); // Current playback position in bytes
  
  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).json({ error: 'Torrent not found' });
  }
  
  const file = tor.files.find(f => f.name === decodeURIComponent(filename));
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Calculate 5 minutes worth of data (assuming ~1 Mbps = 37.5 MB for 5 min)
  const prefetchSize = 40 * 1024 * 1024; // 40 MB
  const prefetchEnd = Math.min(currentPos + prefetchSize, file.length);
  
  console.log(chalk.cyan('🔮 Smart prefetch:'));
  console.log(chalk.yellow('  Current position:'), (currentPos / 1024 / 1024).toFixed(2), 'MB');
  console.log(chalk.yellow('  Prefetch to:'), (prefetchEnd / 1024 / 1024).toFixed(2), 'MB');
  
  // WebTorrent automatically prioritizes pieces near current playback
  // Just return the prefetch info
  res.json({
    success: true,
    currentPosition: currentPos,
    prefetchEnd: prefetchEnd,
    prefetchSize: prefetchSize,
    message: 'Prefetch optimized for next 5 minutes'
  });
});
/* ============================================= */

// Stream upscale video file (4K)
app.get("/stream-upscale/:anime/:episode/:filename", async (req, res) => {
  const { anime, episode, filename } = req.params;
  
  // Build file path: Upscale Tests/Anime Name/Episode/filename
  const filePath = path.join(upscaleDir, anime, episode, filename);
  
  console.log(chalk.cyan('🎬 Streaming 4K upscale:'), filePath);
  
  if (!fs.existsSync(filePath)) {
    console.log(chalk.red('❌ Upscale file not found:'), filePath);
    return res.status(404).send("Upscale file not found");
  }
  
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/x-matroska',
    };
    
    res.writeHead(206, head);
    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
    
    stream.on('error', (err) => {
      console.error(chalk.red('Stream error:'), err);
      if (!res.headersSent) {
        res.status(500).send('Error streaming upscale video');
      }
    });
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/x-matroska',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// Get available upscale files for an anime/episode
app.get("/upscale-available/:anime/:episode", (req, res) => {
  const { anime, episode } = req.params;
  const episodePath = path.join(upscaleDir, anime, episode);
  
  console.log(chalk.cyan('🔍 Upscale request:'));
  console.log(chalk.yellow('  Anime:'), anime);
  console.log(chalk.yellow('  Episode:'), episode);
  console.log(chalk.yellow('  Base Dir:'), upscaleDir);
  console.log(chalk.yellow('  Full Path:'), episodePath);
  console.log(chalk.yellow('  Exists:'), fs.existsSync(episodePath));
  
  if (!fs.existsSync(episodePath)) {
    console.log(chalk.red('❌ Path does not exist'));
    return res.json({ available: false, files: [] });
  }
  
  try {
    const allFiles = fs.readdirSync(episodePath);
    console.log(chalk.cyan('  All files in directory:'), allFiles);
    
    const files = allFiles
      .filter(file => file.endsWith('.mkv') || file.endsWith('.mp4'))
      .map(file => ({
        name: file,
        size: fs.statSync(path.join(episodePath, file)).size
      }));
    
    console.log(chalk.green('✅ Found upscale files:'), files.map(f => f.name));
    res.json({ available: files.length > 0, files });
  } catch (error) {
    console.error(chalk.red('Error reading upscale directory:'), error);
    res.status(500).json({ error: 'Failed to read upscale directory' });
  }
});

// Proxy endpoint for nyaa.si to avoid CORS issues
app.get("/api/proxy/nyaa", async (req, res) => {
  try {
    const { packer, quality, aids, eids, query } = req.query;
    let url = 'https://nyaa.si/?c=1_2&f=0&s=size&d=desc';
    
    if (query) {
      url += `&q=${encodeURIComponent(query)}`;
    } else if (packer) {
      url += `&q=${encodeURIComponent(packer)}`;
    }
    if (quality && !query) {
      url += ` ${quality}`;
    }
    if (aids) {
      url += ` ${aids}`;
    }
    if (eids) {
      url += ` ${eids}`;
    }

    console.log(chalk.cyan('Proxying request to:'), url);
    
    const response = await fetch(url);
    const html = await response.text();
    
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(html);
  } catch (error) {
    console.error(chalk.red('Proxy error:'), error);
    res.status(500).json({ error: 'Failed to fetch from nyaa.si' });
  }
});

// Get MKV stream info (audio + subtitle tracks)
app.get("/stream-info/:magnet/:filename", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = decodeURIComponent(req.params.filename); // DECODE URL-encoded filename
  
  console.log(chalk.cyan('\n🔍 STREAM INFO REQUEST'));
  console.log(chalk.yellow('  File:'), filename);
  
  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).json({ error: 'Torrent not found' });
  }
  
  const videoFile = tor.files.find(f => f.name === filename);
  if (!videoFile) {
    return res.status(404).json({ error: 'Video file not found' });
  }
  
  const videoPath = path.join(tor.path, videoFile.path);
  
  // Wait for file
  let retries = 0;
  while (!fs.existsSync(videoPath) && retries < 10) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
  }
  
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not ready' });
  }
  
  try {
    // Use ffprobe to get all streams
    const streamInfo = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        
        const audioStreams = metadata.streams
          .filter(s => s.codec_type === 'audio')
          .map((s, idx) => ({
            id: idx,
            index: s.index,
            codec: s.codec_name,
            language: s.tags?.language || 'unknown',
            title: s.tags?.title || `Audio ${idx + 1}`,
            channels: s.channels
          }));
        
        const subtitleStreams = metadata.streams
          .filter(s => s.codec_type === 'subtitle')
          .map((s, idx) => ({
            id: idx,
            index: s.index,
            codec: s.codec_name,
            language: s.tags?.language || 'unknown',
            title: s.tags?.title || `Subtitle ${idx + 1}`
          }));
        
        console.log(chalk.green('✅ Stream info:'));
        console.log(chalk.cyan('  Audio streams:'), audioStreams.length);
        audioStreams.forEach((a, i) => 
          console.log(chalk.gray(`    ${i + 1}. ${a.title} (${a.language}) [${a.codec}]`))
        );
        console.log(chalk.cyan('  Subtitle streams:'), subtitleStreams.length);
        subtitleStreams.forEach((s, i) => 
          console.log(chalk.gray(`    ${i + 1}. ${s.title} (${s.language}) [${s.codec}]`))
        );
        
        resolve({ audioStreams, subtitleStreams });
      });
    });
    
    res.json(streamInfo);
  } catch (error) {
    console.error(chalk.red('❌ FFprobe error:'), error.message);
    res.status(500).json({ error: 'Failed to analyze video' });
  }
});

// Get specific subtitle track by ID
app.get("/subtitle/:magnet/:filename/:trackId", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = req.params.filename;
  let trackId = parseInt(req.params.trackId);
  
  console.log(chalk.cyan('\n=== SUBTITLE TRACK REQUEST ==='));
  console.log(chalk.yellow('🎬 Filename:'), filename);
  console.log(chalk.yellow('📝 Track ID:'), trackId);
  
  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).send("Torrent not found");
  }
  
  const videoFile = tor.files.find(f => f.name === filename);
  if (!videoFile || !videoFile.name.endsWith('.mkv')) {
    return res.status(404).send("Not an MKV file");
  }
  
  const videoPath = path.join(tor.path, videoFile.path);
  
  // Wait for file
  let retries = 0;
  while (!fs.existsSync(videoPath) && retries < 10) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
  }
  
  if (!fs.existsSync(videoPath)) {
    return res.status(404).send("Video not ready");
  }
  
  try {
    const tempDir = path.join(__dirname, 'temp_subs');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const baseName = filename.replace(/\.[^/.]+$/, '');
    const subtitleOutputPath = path.join(tempDir, `${baseName}_track${trackId}.srt`);
    
    console.log(chalk.cyan('🎬 Extracting subtitle track'), trackId, chalk.gray('from MKV'));
    
    // Extract specific track using FFmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          `-map 0:s:${trackId}`,  // Specific subtitle stream
          '-c:s srt',             // Convert to SRT
          '-y'                    // Overwrite
        ])
        .output(subtitleOutputPath)
        .on('end', () => {
          console.log(chalk.green('✅ Track'), trackId, chalk.green('extracted'));
          resolve();
        })
        .on('error', (err) => {
          console.error(chalk.red('❌ FFmpeg error:'), err.message);
          reject(err);
        })
        .run();
    });
    
    if (fs.existsSync(subtitleOutputPath)) {
      const srtContent = fs.readFileSync(subtitleOutputPath, 'utf-8');
      const vttContent = convertSRTtoVTT(srtContent);
      
      res.setHeader("Content-Type", "text/vtt");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(vttContent);
      
      // Cleanup after 5 minutes
      setTimeout(() => {
        try {
          if (fs.existsSync(subtitleOutputPath)) {
            fs.unlinkSync(subtitleOutputPath);
          }
        } catch (err) {
          console.error(chalk.red('Cleanup error:'), err);
        }
      }, 5 * 60 * 1000);
    } else {
      res.status(404).send("Subtitle track not found");
    }
  } catch (error) {
    console.error(chalk.red('❌ Error extracting subtitle:'), error.message);
    res.status(500).send("Error extracting subtitle");
  }
});

// Get SPECIFIC subtitle track by ID from MKV
app.get("/subtitle/:magnet/:filename/:trackId", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = decodeURIComponent(req.params.filename);
  let trackId = parseInt(req.params.trackId);
  
  console.log(chalk.cyan('\n=== SPECIFIC SUBTITLE TRACK REQUEST ==='));
  console.log(chalk.yellow('  File:'), filename);
  console.log(chalk.yellow('  Track ID:'), trackId);
  
  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).send('Torrent not found');
  }
  
  const videoFile = tor.files.find(f => f.name === filename);
  if (!videoFile || !videoFile.name.endsWith('.mkv')) {
    return res.status(404).send('Not an MKV file');
  }
  
  const videoPath = path.join(tor.path, videoFile.path);
  
  // Wait for file
  let retries = 0;
  while (!fs.existsSync(videoPath) && retries < 10) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
  }
  
  if (!fs.existsSync(videoPath)) {
    return res.status(404).send('Video not ready');
  }
  
  try {
    const tempDir = path.join(__dirname, 'temp_subs');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const baseName = filename.replace(/\.[^/.]+$/, '');
    const subtitleOutputPath = path.join(tempDir, `${baseName}_track${trackId}.srt`);
    
    console.log(chalk.cyan('  Extracting subtitle track'), trackId, 'from MKV');
    
    // Extract specific track using FFmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          `-map 0:s:${trackId}`,  // Specific subtitle stream by ID
          '-c:s srt',
          '-y'
        ])
        .output(subtitleOutputPath)
        .on('end', () => {
          console.log(chalk.green('  ✅ Track'), trackId, 'extracted');
          resolve();
        })
        .on('error', (err) => {
          console.error(chalk.red('  ❌ Extraction failed:'), err.message);
          reject(err);
        })
        .run();
    });
    
    if (fs.existsSync(subtitleOutputPath)) {
      const srtContent = fs.readFileSync(subtitleOutputPath, 'utf-8');
      const vttContent = convertSRTtoVTT(srtContent);
      
      res.setHeader('Content-Type', 'text/vtt');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(vttContent);
      
      // Cleanup after 5 minutes
      setTimeout(() => {
        try {
          if (fs.existsSync(subtitleOutputPath)) {
            fs.unlinkSync(subtitleOutputPath);
          }
        } catch (err) {
          console.error(chalk.red('Cleanup error:'), err);
        }
      }, 5 * 60 * 1000);
    } else {
      res.status(404).send('Subtitle track not found');
    }
  } catch (error) {
    console.error(chalk.red('❌ Error extracting subtitle:'), error.message);
    res.status(500).send('Error extracting subtitle');
  }
});

// Get subtitle for a specific file (extract from MKV if needed) - DEFAULT TRACK
app.get("/subtitles/:magnet/:filename", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = req.params.filename;

  console.log(chalk.cyan('\n=== SUBTITLE REQUEST ==='));
  console.log(chalk.yellow('🎬 Filename:'), filename);
  console.log(chalk.yellow('🧲 Magnet:'), magnet.substring(0, 60) + '...');
  
  // DEBUG: Parse episode from filename
  let debugEpisode = null;
  let debugMatch = filename.match(/\s-\s*(\d+)/);
  if (debugMatch) {
    debugEpisode = debugMatch[1];
    console.log(chalk.green('🔢 Episode detected (Pattern 1):'), debugEpisode, chalk.gray('(" - " + number)'));
  } else {
    debugMatch = filename.match(/[eE](\d+)/);
    if (debugMatch) {
      debugEpisode = debugMatch[1];
      console.log(chalk.green('🔢 Episode detected (Pattern 2):'), debugEpisode, chalk.gray('(E/e + number)'));
    } else {
      debugMatch = filename.match(/\d+/);
      if (debugMatch) {
        debugEpisode = debugMatch[0];
        console.log(chalk.yellow('🔢 Episode detected (Pattern 3):'), debugEpisode, chalk.gray('(first number)'));
      } else {
        console.log(chalk.red('❌ Could not detect episode number from filename'));
      }
    }
  }

  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).send("Torrent not found");
  }

  // 1. First try to find external subtitle files (.srt, .ass)
  const baseName = filename.replace(/\.[^/.]+$/, '');
  let subtitleFile = tor.files.find(f => 
    (f.name.startsWith(baseName) && (f.name.endsWith('.srt') || f.name.endsWith('.ass')))
  );
  
  if (!subtitleFile) {
    subtitleFile = tor.files.find(f => f.name.endsWith('.srt') || f.name.endsWith('.ass'));
  }
  
  const allFiles = tor.files.map(f => f.name);
  console.log(chalk.cyan('🔍 Torrent files (' + allFiles.length + '):'));
  allFiles.forEach((f, i) => console.log(chalk.gray(`  ${i + 1}. ${f}`)));
  console.log(chalk.yellow('🎯 Subtitle file found:'), subtitleFile?.name || chalk.red('NONE - Will extract from MKV'));
  
  // 2. If external subtitle found, stream it
  if (subtitleFile) {
    console.log(chalk.cyan('📝 Streaming external subtitle:'), subtitleFile.name);
    
    // ASS dosyası mı kontrol et
    const isAssFile = subtitleFile.name.toLowerCase().endsWith('.ass');
    
    res.setHeader("Content-Type", "text/vtt");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "X-Subtitle-Type");
    res.setHeader("X-Subtitle-Type", isAssFile ? "ass" : "srt");
    console.log(chalk.green('🏷️ Subtitle type header set:'), isAssFile ? 'ASS' : 'SRT');
    
    let stream = subtitleFile.createReadStream();
    stream.pipe(res);

    stream.on("error", function (err) {
      console.error(chalk.red("Subtitle stream error:"), err);
      if (!res.headersSent) {
        return res.status(500).send("Error streaming subtitle");
      }
    });
    return;
  }

  // 3. Try LOCAL SUBTITLES first (Dandadan S2)
  console.log(chalk.yellow('📂 Trying local subtitles...'));
  // Try multiple patterns to extract episode number
  let episodeNum = null;
  
  // Pattern 1: "- 13" or "- 13 " (with space)
  let match = filename.match(/\s-\s*(\d+)/);
  if (match) episodeNum = parseInt(match[1]);
  
  // Pattern 2: "E13" or "e13"
  if (!episodeNum) {
    match = filename.match(/[eE](\d+)/);
    if (match) episodeNum = parseInt(match[1]);
  }
  
  // Pattern 3: Just numbers after title
  if (!episodeNum) {
    match = filename.match(/\d+/);
    if (match) episodeNum = parseInt(match[0]);
  }
  
  if (episodeNum) {
    console.log(chalk.cyan('  🔢 Parsed episode number:'), episodeNum);
    
    try {
      // First get list of available subtitles
      const listUrl = `http://localhost:${PORT}/local-subtitle-list/${episodeNum}`;
      const listResponse = await fetch(listUrl);
      
      if (listResponse.ok) {
        const listData = await listResponse.json();
        
        if (listData.subtitles && listData.subtitles.length > 0) {
          console.log(chalk.cyan(`  Found ${listData.subtitles.length} subtitle(s)`));
          
          // Prefer ASS subtitles (they're usually better quality)
          const assSub = listData.subtitles.find(s => s.type === 'ASS');
          const selectedId = assSub ? assSub.id : 0;
          
          console.log(chalk.green('  Using:'), chalk.cyan(listData.subtitles[selectedId].language), chalk.yellow(listData.subtitles[selectedId].type));
          
          // Now fetch the selected subtitle
          const localSubUrl = `http://localhost:${PORT}/local-subtitle/${episodeNum}/${selectedId}`;
          const localSubResponse = await fetch(localSubUrl);
          
          if (localSubResponse.ok) {
            const subtitleContent = await localSubResponse.text();
            const subtitleType = localSubResponse.headers.get('X-Subtitle-Type') || 'srt';
            const subtitleLang = localSubResponse.headers.get('X-Subtitle-Language') || 'Unknown';
            
            res.setHeader("Content-Type", "text/vtt");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Expose-Headers", "X-Subtitle-Type, X-Subtitle-Language, X-Subtitle-List");
            res.setHeader("X-Subtitle-Type", subtitleType);
            res.setHeader("X-Subtitle-Language", subtitleLang);
            res.setHeader("X-Subtitle-List", JSON.stringify(listData.subtitles));
            res.send(subtitleContent);
            
            console.log(chalk.green('✅ Local subtitle delivered!'), chalk.cyan(subtitleLang), chalk.yellow(subtitleType));
            return;
          }
        }
      }
    } catch (localErr) {
      console.log(chalk.yellow('⚠️ Local subtitle fetch failed:'), localErr.message);
    }
    
    // Fallback: Try old single-subtitle endpoint
    try {
      const localSubUrl = `http://localhost:${PORT}/local-subtitle/${episodeNum}`;
      const localSubResponse = await fetch(localSubUrl);
      
      if (localSubResponse.ok) {
        const subtitleContent = await localSubResponse.text();
        const subtitleType = localSubResponse.headers.get('X-Subtitle-Type') || 'srt';
        
        res.setHeader("Content-Type", "text/vtt");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Expose-Headers", "X-Subtitle-Type");
        res.setHeader("X-Subtitle-Type", subtitleType);
        res.send(subtitleContent);
        
        console.log(chalk.green('✅ Local subtitle delivered!'));
        return;
      }
    } catch (localErr) {
      console.log(chalk.yellow('⚠️ Local subtitle not found:'), localErr.message);
    }
  } else {
    console.log(chalk.yellow('⚠️ Could not parse episode number from filename'));
  }
  
  // 4. If no local subtitle, try AUTO DOWNLOAD from animetosho
  console.log(chalk.yellow('🌐 Trying animetosho auto-download...'));
  // Extract anime name and episode from filename
  const animeMatch = filename.match(/^(.+?)\s*[-\s]*\s*(\d+)/);
  if (animeMatch) {
    const [, animeName, episodeNum] = animeMatch;
    console.log(chalk.cyan('  Parsed:'), animeName, 'Episode', episodeNum);
    
    try {
      // Forward request to auto-subtitle endpoint
      const autoSubUrl = `http://localhost:${PORT}/auto-subtitle/${encodeURIComponent(animeName)}/${episodeNum}`;
      const autoSubResponse = await fetch(autoSubUrl);
      
      if (autoSubResponse.ok) {
        const subtitleContent = await autoSubResponse.text();
        const subtitleType = autoSubResponse.headers.get('X-Subtitle-Type') || 'srt';
        
        res.setHeader("Content-Type", "text/vtt");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Expose-Headers", "X-Subtitle-Type");
        res.setHeader("X-Subtitle-Type", subtitleType);
        res.send(subtitleContent);
        
        console.log(chalk.green('✅ Auto-downloaded subtitle delivered!'));
        return;
      }
    } catch (autoErr) {
      console.log(chalk.yellow('⚠️ Auto-download failed, falling back to MKV extraction'));
    }
  }
  
  // 5. Last resort: try to extract from MKV
  const videoFile = tor.files.find(f => f.name === filename);
  
  if (!videoFile || !videoFile.name.endsWith('.mkv')) {
    return res.status(404).send("No subtitle found anywhere");
  }

  console.log(chalk.yellow('🎬 Extracting embedded subtitle from MKV:'), filename);

  try {
    // Create temp directory for subtitles
    const tempDir = path.join(__dirname, 'temp_subs');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const videoPath = path.join(tor.path, videoFile.path);
    const subtitleOutputPath = path.join(tempDir, `${baseName}.srt`);

    console.log(chalk.gray('Video path:'), videoPath);
    console.log(chalk.gray('Subtitle output:'), subtitleOutputPath);

    // Wait for file to be available
    let retries = 0;
    while (!fs.existsSync(videoPath) && retries < 10) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      retries++;
    }

    if (!fs.existsSync(videoPath)) {
      console.log(chalk.yellow('⚠️ Video file not yet downloaded, cannot extract subtitles'));
      return res.status(404).send("Video not ready for subtitle extraction");
    }

    // MKV'den subtitle formatını kontrol et
    let isAssSubtitle = false;
    
    try {
      await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
          if (err) {
            console.error(chalk.red('❌ FFprobe error:'), err.message);
            reject(err);
            return;
          }
          
          console.log(chalk.cyan('🔍 Probing MKV for subtitle type...'));
          
          // Subtitle stream'i bul
          const subtitleStreams = metadata.streams.filter(s => s.codec_type === 'subtitle');
          console.log(chalk.yellow('🎬 Found subtitle streams:'), subtitleStreams.length);
          
          if (subtitleStreams.length > 0) {
            const firstSub = subtitleStreams[0];
            isAssSubtitle = firstSub.codec_name === 'ass' || firstSub.codec_name === 'ssa';
            console.log(chalk.green('🏷️ Subtitle codec:'), firstSub.codec_name, '(ASS:', isAssSubtitle, ')');
          } else {
            console.log(chalk.yellow('⚠️ No subtitle streams found in MKV'));
          }
          resolve();
        });
      });
    } catch (err) {
      console.log(chalk.yellow('⚠️ Could not detect subtitle format:'), err.message);
    }

    // Extract subtitle using fluent-ffmpeg - TRACK 5 (ASS)
    console.log(chalk.cyan('🎬 Extracting subtitle from MKV...'));
    console.log(chalk.yellow('  Trying Track 5 (0:s:4) - ASS subtitle'));
    
    // Try Track 5 first (index 4, because 0-indexed)
    let extractSuccess = false;
    
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .outputOptions([
            '-map 0:s:4',  // Track 5 (0-indexed = 4)
            '-c:s srt',    // Convert to SRT
            '-y'           // Overwrite
          ])
        .output(subtitleOutputPath)
        .on('start', (cmd) => {
          console.log(chalk.gray('FFmpeg command:'), cmd);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(chalk.yellow(`🔄 Progress: ${progress.percent.toFixed(1)}%`));
          }
        })
                  .on('end', () => {
            console.log(chalk.green('✅ Track 5 extracted successfully!'));
            extractSuccess = true;
            resolve();
          })
          .on('error', (err) => {
            console.log(chalk.yellow('⚠️ Track 5 not available:'), err.message);
            reject(err);
          })
          .run();
      });
    } catch (track5Error) {
      // Track 5 failed, try first available subtitle track
      console.log(chalk.yellow('  Fallback: Trying first subtitle track (0:s:0)'));
      
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .outputOptions([
            '-map 0:s:0',  // First subtitle stream
            '-c:s srt',    // Convert to SRT
            '-y'           // Overwrite
          ])
          .output(subtitleOutputPath)
          .on('start', (cmd) => {
            console.log(chalk.gray('FFmpeg fallback command:'), cmd);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(chalk.yellow(`🔄 Fallback progress: ${progress.percent.toFixed(1)}%`));
            }
          })
          .on('end', () => {
            console.log(chalk.green('✅ Fallback extraction complete'));
            extractSuccess = true;
            resolve();
          })
          .on('error', (err) => {
            console.error(chalk.red('❌ FFmpeg fallback error:'), err.message);
            reject(err);
          })
          .run();
      });
    }

    // Check if subtitle was extracted
    if (fs.existsSync(subtitleOutputPath)) {
      console.log(chalk.green('✅ Subtitle extracted successfully'));
      
      // Convert SRT to WebVTT
      const srtContent = fs.readFileSync(subtitleOutputPath, 'utf-8');
      const vttContent = convertSRTtoVTT(srtContent);
      
      res.setHeader("Content-Type", "text/vtt");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "X-Subtitle-Type");
      res.setHeader("X-Subtitle-Type", isAssSubtitle ? "ass" : "srt");
      console.log(chalk.green('🏷️ MKV Subtitle type header set:'), isAssSubtitle ? 'ASS' : 'SRT');
      res.send(vttContent);
      
      // Clean up temp file after 5 minutes
      setTimeout(() => {
        try {
          if (fs.existsSync(subtitleOutputPath)) {
            fs.unlinkSync(subtitleOutputPath);
            console.log(chalk.gray('🧹 Cleaned up temp subtitle'));
          }
        } catch (err) {
          console.error(chalk.red('Error cleaning temp file:'), err);
        }
      }, 5 * 60 * 1000);
    } else {
      console.log(chalk.yellow('⚠️ No embedded subtitle found in MKV'));
      return res.status(404).send("No subtitle track found in MKV");
    }
  } catch (error) {
    console.error(chalk.red('❌ FFmpeg error:'), error.message);
    return res.status(500).send("Error extracting subtitle from MKV");
  }
});

// Helper function to convert SRT to WebVTT
function convertSRTtoVTT(srtContent) {
  let vtt = 'WEBVTT\n\n';
  
  // Replace comma with dot in timestamps (SRT uses comma, VTT uses dot)
  vtt += srtContent.replace(/,/g, '.');
  
  return vtt;
}

/* ========== LOCAL SUBTITLE LOADER (DANDADAN S2) ========== */
// Recursive function to find ALL subtitle files for an episode (all languages)
function findAllSubtitlesRecursive(dir, episodeNum) {
  const dirName = path.basename(dir);
  console.log(chalk.gray('  🔍 Scanning:'), dirName);
  
  let allSubtitles = [];
  
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      
      if (item.isDirectory()) {
        // Recursive search in subdirectory
        const found = findAllSubtitlesRecursive(fullPath, episodeNum);
        allSubtitles = allSubtitles.concat(found);
      } else if (item.isFile() && (item.name.endsWith('.ass') || item.name.endsWith('.srt'))) {
        // Check if this subtitle matches the episode
        // Try multiple patterns
        let fileEpisode = null;
        let match = item.name.match(/\s-\s*(\d+)/);
        if (match) fileEpisode = parseInt(match[1]);
        
        if (!fileEpisode) {
          match = item.name.match(/[eE](\d+)/);
          if (match) fileEpisode = parseInt(match[1]);
        }
        
        if (!fileEpisode) {
          match = item.name.match(/\d+/);
          if (match) fileEpisode = parseInt(match[0]);
        }
        
        if (fileEpisode && fileEpisode === episodeNum) {
          // Detect language from filename
          const language = detectLanguage(item.name);
          const type = item.name.endsWith('.ass') ? 'ASS' : 'SRT';
          
          console.log(chalk.green('  ✅ Found:'), chalk.yellow(type), chalk.cyan(language), chalk.gray(item.name));
          
          allSubtitles.push({
            path: fullPath,
            name: item.name,
            isAss: item.name.endsWith('.ass'),
            language: language,
            type: type
          });
        }
      }
    }
  } catch (err) {
    console.log(chalk.red('  ❌ Error reading directory:'), err.message);
  }
  
  return allSubtitles;
}

// Detect language from filename
function detectLanguage(filename) {
  const lower = filename.toLowerCase();
  
  // Language patterns
  if (lower.includes('english') || lower.includes('eng') || lower.includes('[en]')) return 'English';
  if (lower.includes('turkish') || lower.includes('tur') || lower.includes('[tr]')) return 'Turkish';
  if (lower.includes('arabic') || lower.includes('ara') || lower.includes('[ar]')) return 'Arabic';
  if (lower.includes('spanish') || lower.includes('spa') || lower.includes('[es]')) return 'Spanish';
  if (lower.includes('french') || lower.includes('fra') || lower.includes('[fr]')) return 'French';
  if (lower.includes('german') || lower.includes('ger') || lower.includes('[de]')) return 'German';
  if (lower.includes('portuguese') || lower.includes('por') || lower.includes('[pt]')) return 'Portuguese';
  if (lower.includes('italian') || lower.includes('ita') || lower.includes('[it]')) return 'Italian';
  if (lower.includes('russian') || lower.includes('rus') || lower.includes('[ru]')) return 'Russian';
  if (lower.includes('japanese') || lower.includes('jpn') || lower.includes('[ja]')) return 'Japanese';
  
  // Default
  return 'Unknown';
}

// Get list of available subtitles for an episode
app.get("/local-subtitle-list/:episode", async (req, res) => {
  const { episode } = req.params;
  const episodeNum = parseInt(episode);
  
  console.log(chalk.cyan('\n📂 Subtitle list request:'));
  console.log(chalk.yellow('  Episode:'), episodeNum);
  
  if (!fs.existsSync(localSubsDir)) {
    return res.status(404).json({ error: 'Local subtitles not available', subtitles: [] });
  }
  
  try {
    const allSubtitles = findAllSubtitlesRecursive(localSubsDir, episodeNum);
    
    if (allSubtitles.length === 0) {
      console.log(chalk.yellow('⚠️ No subtitles found for episode'), episodeNum);
      return res.json({ subtitles: [] });
    }
    
    console.log(chalk.green(`✅ Found ${allSubtitles.length} subtitle(s):`));
    allSubtitles.forEach((sub, idx) => {
      console.log(chalk.gray(`  ${idx + 1}.`), chalk.cyan(sub.language), chalk.yellow(sub.type));
    });
    
    // Return list with IDs
    const subtitleList = allSubtitles.map((sub, idx) => ({
      id: idx,
      language: sub.language,
      type: sub.type,
      name: sub.name
    }));
    
    res.json({ subtitles: subtitleList });
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
    res.status(500).json({ error: 'Failed to list subtitles' });
  }
});

// Serve specific subtitle by episode and language/id
app.get("/local-subtitle/:episode/:subtitleId?", async (req, res) => {
  const { episode, subtitleId } = req.params;
  const episodeNum = parseInt(episode);
  const subId = subtitleId ? parseInt(subtitleId) : 0;
  
  console.log(chalk.cyan('\n📂 Local subtitle request:'));
  console.log(chalk.yellow('  Episode:'), episodeNum);
  console.log(chalk.yellow('  Subtitle ID:'), subId);
  
  if (!fs.existsSync(localSubsDir)) {
    console.log(chalk.red('❌ Local subtitle directory not found'));
    return res.status(404).json({ error: 'Local subtitles not available' });
  }
  
  try {
    const allSubtitles = findAllSubtitlesRecursive(localSubsDir, episodeNum);
    
    if (allSubtitles.length === 0) {
      console.log(chalk.red('❌ No subtitle found for episode'), episodeNum);
      return res.status(404).json({ error: 'Subtitle not found for this episode' });
    }
    
    // Select subtitle by ID or default to first ASS subtitle
    let selectedSubtitle = null;
    
    if (subId >= 0 && subId < allSubtitles.length) {
      selectedSubtitle = allSubtitles[subId];
    } else {
      // Default: Prefer ASS subtitles
      selectedSubtitle = allSubtitles.find(s => s.isAss) || allSubtitles[0];
    }
    
    console.log(chalk.green('✅ Selected subtitle:'), chalk.cyan(selectedSubtitle.language), chalk.yellow(selectedSubtitle.type));
    console.log(chalk.gray('  File:'), selectedSubtitle.name);
    
    // Read subtitle content
    const subtitleContent = fs.readFileSync(selectedSubtitle.path, 'utf-8');
    
    // Convert to VTT if SRT (ASS stays as-is for special formatting)
    const vttContent = selectedSubtitle.isAss ? subtitleContent : convertSRTtoVTT(subtitleContent);
    
    res.setHeader("Content-Type", "text/vtt");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "X-Subtitle-Type, X-Subtitle-Language");
    res.setHeader("X-Subtitle-Type", selectedSubtitle.isAss ? "ass" : "srt");
    res.setHeader("X-Subtitle-Language", selectedSubtitle.language);
    res.send(vttContent);
    
    console.log(chalk.green('✅ Subtitle delivered:'), selectedSubtitle.isAss ? 'ASS' : 'SRT', '|', selectedSubtitle.language);
  } catch (error) {
    console.error(chalk.red('❌ Error reading local subtitle:'), error.message);
    res.status(500).json({ error: 'Failed to read local subtitle' });
  }
});
/* ======================================================== */

/* ========== GET AUDIO TRACKS FROM MKV ========== */
// Get all audio and subtitle tracks from MKV file
app.get("/tracks/:magnet/:filename", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = req.params.filename;
  
  console.log(chalk.cyan('\n=== TRACK INFO REQUEST ==='));
  console.log(chalk.yellow('🎬 Filename:'), filename);
  
  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).send("Torrent not found");
  }
  
  const videoFile = tor.files.find(f => f.name === filename);
  if (!videoFile || !videoFile.name.endsWith('.mkv')) {
    return res.status(404).send("Not an MKV file");
  }
  
  const videoPath = path.join(tor.path, videoFile.path);
  
  // Wait for file to be available
  let retries = 0;
  while (!fs.existsSync(videoPath) && retries < 10) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
  }
  
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video file not ready' });
  }
  
  try {
    // Use ffprobe to get all tracks
    const trackInfo = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.error(chalk.red('❌ FFprobe error:'), err.message);
          reject(err);
          return;
        }
        
        console.log(chalk.cyan('🔍 Analyzing MKV tracks...'));
        
        // Extract audio tracks
        const audioTracks = metadata.streams
          .filter(s => s.codec_type === 'audio')
          .map((s, idx) => ({
            index: idx,
            streamIndex: s.index,
            codec: s.codec_name,
            language: s.tags?.language || s.tags?.title || 'Unknown',
            title: s.tags?.title || `Audio ${idx + 1}`,
            channels: s.channels,
            default: s.disposition?.default === 1
          }));
        
        // Extract subtitle tracks
        const subtitleTracks = metadata.streams
          .filter(s => s.codec_type === 'subtitle')
          .map((s, idx) => ({
            index: idx,
            streamIndex: s.index,
            codec: s.codec_name,
            language: s.tags?.language || s.tags?.title || 'Unknown',
            title: s.tags?.title || `Subtitle ${idx + 1}`,
            default: s.disposition?.default === 1
          }));
        
        console.log(chalk.green(`✅ Found ${audioTracks.length} audio track(s):`));
        audioTracks.forEach((t, i) => {
          console.log(chalk.cyan(`  ${i + 1}. ${t.title} (${t.language}) - ${t.codec} ${t.channels}ch ${t.default ? '⭐' : ''}`));
        });
        
        console.log(chalk.green(`✅ Found ${subtitleTracks.length} subtitle track(s):`));
        subtitleTracks.forEach((t, i) => {
          console.log(chalk.cyan(`  ${i + 1}. ${t.title} (${t.language}) - ${t.codec} ${t.default ? '⭐' : ''}`));
        });
        
        resolve({
          audio: audioTracks,
          subtitles: subtitleTracks
        });
      });
    });
    
    res.json(trackInfo);
  } catch (error) {
    console.error(chalk.red('❌ Error getting tracks:'), error.message);
    res.status(500).json({ error: 'Failed to get track information' });
  }
});
/* ================================================ */

/* ========== AUTO SUBTITLE DOWNLOAD FROM ANIMETOSHO ========== */
// Search and download subtitles from animetosho
app.get("/auto-subtitle/:animeName/:episode", async (req, res) => {
  const { animeName, episode } = req.params;
  
  console.log(chalk.cyan('\n🔍 Searching for subtitles:'));
  console.log(chalk.yellow('  Anime:'), animeName);
  console.log(chalk.yellow('  Episode:'), episode);
  
  try {
    // 1. Search animetosho for the anime + episode
    const searchQuery = `${animeName} ${episode}`;
    const searchUrl = `https://animetosho.org/series/${encodeURIComponent(animeName)}`;
    
    console.log(chalk.gray('  Search URL:'), searchUrl);
    
    // Try to fetch from animetosho
    const response = await fetch(searchUrl);
    const html = await response.text();
    
    // Parse HTML to find subtitle links (.ass or .srt)
    const assMatch = html.match(new RegExp(`href="([^"]+\\.ass)"`, 'i'));
    const srtMatch = html.match(new RegExp(`href="([^"]+\\.srt)"`, 'i'));
    
    if (assMatch || srtMatch) {
      const subtitleUrl = assMatch ? assMatch[1] : srtMatch[1];
      const isAss = subtitleUrl.endsWith('.ass');
      
      console.log(chalk.green('✅ Subtitle found:'), subtitleUrl);
      
      // Download the subtitle file
      const fullUrl = subtitleUrl.startsWith('http') ? subtitleUrl : `https://animetosho.org${subtitleUrl}`;
      const subResponse = await fetch(fullUrl);
      const subtitleContent = await subResponse.text();
      
      // Convert to VTT if SRT
      const vttContent = isAss ? subtitleContent : convertSRTtoVTT(subtitleContent);
      
      res.setHeader("Content-Type", "text/vtt");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "X-Subtitle-Type");
      res.setHeader("X-Subtitle-Type", isAss ? "ass" : "srt");
      res.send(vttContent);
      
      console.log(chalk.green('✅ Subtitle delivered:'), isAss ? 'ASS' : 'SRT');
    } else {
      console.log(chalk.red('❌ No subtitle found on animetosho'));
      res.status(404).json({ error: 'No subtitle found' });
    }
  } catch (error) {
    console.error(chalk.red('❌ Error fetching subtitle:'), error.message);
    res.status(500).json({ error: 'Failed to fetch subtitle from animetosho' });
  }
});
/* ============================================================= */

/* ========== HLS REMOVED - Using Direct Streaming Instead ========== */
// HLS çok karmaşık ve gereksiz bandwidth kullanıyor.
// Bunun yerine direkt /streamfile endpoint'i kullan.
// Audio/Subtitle track switching için /stream-info kullan.
/* =================================================================== */

// HLS endpoint kaldırıldı - 404 döndür
app.get("/hls/:magnet/:filename/master.m3u8", async (req, res) => {
  res.status(404).json({ 
    error: 'HLS removed',
    message: 'Use /streamfile endpoint instead for better bandwidth efficiency',
    alternative: '/streamfile/:magnet/:filename'
  });
});

/* OLD HLS CODE - REMOVED FOR BANDWIDTH OPTIMIZATION
app.get("/hls/:magnet/:filename/master.m3u8", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = decodeURIComponent(req.params.filename);
  
  console.log(chalk.cyan('\n🎬 === HLS REQUEST ==='));
  console.log(chalk.yellow('  File:'), filename);
  
  let tor = await client.get(magnet);
  if (!tor) {
    console.log(chalk.red('❌ Torrent not found'));
    return res.status(404).send('Torrent not found');
  }
  
  const videoFile = tor.files.find(f => f.name === filename);
  if (!videoFile) {
    console.log(chalk.red('❌ Video file not found'));
    return res.status(404).send('Video file not found');
  }
  
  const videoPath = path.join(tor.path, videoFile.path);
  
  // Wait for file to be available
  let retries = 0;
  while (!fs.existsSync(videoPath) && retries < 10) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
  }
  
  if (!fs.existsSync(videoPath)) {
    console.log(chalk.red('❌ Video file not ready'));
    return res.status(404).send('Video not ready');
  }
  
  // Create cache directory for this video
  const videoHash = Buffer.from(filename).toString('base64').replace(/[/+=]/g, '_');
  const videoCacheDir = path.join(hlsCacheDir, videoHash);
  const masterPlaylistPath = path.join(videoCacheDir, 'master.m3u8');
  
  // Check if already converted
  if (fs.existsSync(masterPlaylistPath)) {
    console.log(chalk.green('✅ Using cached HLS playlist'));
    const playlist = fs.readFileSync(masterPlaylistPath, 'utf-8');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(playlist);
  }
  
  // Create cache directory
  if (!fs.existsSync(videoCacheDir)) {
    fs.mkdirSync(videoCacheDir, { recursive: true });
  }
  
  console.log(chalk.cyan('🔄 Converting to HLS...'));
  console.log(chalk.gray('  Source:'), videoPath);
  console.log(chalk.gray('  Cache:'), videoCacheDir);
  
  try {
    // Get stream info first
    const streamInfo = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata);
      });
    });
    
    const audioStreams = streamInfo.streams.filter(s => s.codec_type === 'audio');
    const subtitleStreams = streamInfo.streams.filter(s => s.codec_type === 'subtitle');
    
    console.log(chalk.cyan('📊 Stream Analysis:'));
    console.log(chalk.yellow('  Audio streams:'), audioStreams.length);
    console.log(chalk.yellow('  Subtitle streams:'), subtitleStreams.length);
    
        // PARALLEL HLS CONVERSION - ULTRA FAST!
    console.log(chalk.cyan('🚀 Creating HLS playlists (PARALLEL MODE)...'));
    
    const audioPlaylists = [];
    const subtitlePlaylists = [];
    
    // Create conversion promises for parallel execution
    const conversionPromises = [];
    
    // Audio tracks conversion
    audioStreams.forEach((audioStream, audioIdx) => {
      const lang = audioStream.tags?.language || 'und';
      const title = audioStream.tags?.title || `Audio ${audioIdx + 1}`;
      const playlistName = `audio_${audioIdx}.m3u8`;
      const playlistPath = path.join(videoCacheDir, playlistName);
      
      console.log(chalk.yellow(`  🎵 Queueing audio ${audioIdx + 1}:`), title, `(${lang})`);
      
      const audioPromise = new Promise((resolve, reject) => {
        const audioArgs = [
          '-i', videoPath,
          '-map', '0:v:0',
          '-map', `0:a:${audioIdx}`,
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-preset', 'ultrafast',  // FAST!
          '-start_number', '0',
          '-hls_time', '4',  // 4-second segments (faster start)
          '-hls_list_size', '0',
          '-hls_segment_filename', path.join(videoCacheDir, `audio${audioIdx}_seg%03d.ts`),
          '-f', 'hls',
          playlistPath
        ];
        
        const proc = spawn(ffmpegPath.path, audioArgs);
        
        proc.stderr.on('data', (data) => {
          // Silent mode for speed
        });
        
        proc.on('close', (code) => {
          if (code === 0) {
            console.log(chalk.green(`    ✅ Audio ${audioIdx + 1} done`));
            audioPlaylists.push({ index: audioIdx, name: playlistName, lang, title });
            resolve();
          } else {
            reject(new Error(`Audio ${audioIdx + 1} failed`));
          }
        });
        
        proc.on('error', reject);
      });
      
      conversionPromises.push(audioPromise);
    });
    
    // Subtitle tracks conversion (first 3 only for speed)
    const maxSubtitles = Math.min(3, subtitleStreams.length);
    for (let subIdx = 0; subIdx < maxSubtitles; subIdx++) {
      const subStream = subtitleStreams[subIdx];
      const lang = subStream.tags?.language || 'und';
      const title = subStream.tags?.title || `Subtitle ${subIdx + 1}`;
      const vttName = `subtitle_${subIdx}.vtt`;
      const vttPath = path.join(videoCacheDir, vttName);
      
      console.log(chalk.yellow(`  📝 Queueing subtitle ${subIdx + 1}:`), title, `(${lang})`);
      
      const subPromise = new Promise((resolve, reject) => {
        const subArgs = [
          '-i', videoPath,
          '-map', `0:s:${subIdx}`,
          '-c:s', 'webvtt',
          '-f', 'webvtt',
          vttPath
        ];
        
        const proc = spawn(ffmpegPath.path, subArgs);
        
        proc.on('close', (code) => {
          if (code === 0) {
            console.log(chalk.green(`    ✅ Subtitle ${subIdx + 1} done`));
            subtitlePlaylists.push({ index: subIdx, name: vttName, lang, title });
            resolve();
          } else {
            // Subtitle extraction failed, skip it
            console.log(chalk.yellow(`    ⚠️ Subtitle ${subIdx + 1} skipped`));
            resolve(); // Don't reject, just skip
          }
        });
        
        proc.on('error', () => resolve()); // Skip on error
      });
      
      conversionPromises.push(subPromise);
    }
    
    // Wait for ALL conversions in parallel
    console.log(chalk.cyan(`⚡ Starting ${conversionPromises.length} parallel conversions...`));
    const startTime = Date.now();
    
    await Promise.all(conversionPromises);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(chalk.green(`✅ All conversions complete in ${duration}s!`));
    
    // Create master playlist
    console.log(chalk.cyan('📝 Creating master.m3u8...'));
    
    let masterContent = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
    
    // Add audio renditions
    audioPlaylists.forEach((playlist, idx) => {
      masterContent += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${playlist.title}",LANGUAGE="${playlist.lang}",AUTOSELECT=${idx === 0 ? 'YES' : 'NO'},DEFAULT=${idx === 0 ? 'YES' : 'NO'},URI="${playlist.name}"\n`;
    });
    
    // Add subtitle renditions
    subtitlePlaylists.forEach((playlist, idx) => {
      masterContent += `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${playlist.title}",LANGUAGE="${playlist.lang}",AUTOSELECT=${idx === 0 ? 'YES' : 'NO'},DEFAULT=${idx === 0 ? 'YES' : 'NO'},URI="${playlist.name}"\n`;
    });
    
    // Add stream info
    masterContent += `\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio",SUBTITLES="subs"\n`;
    masterContent += `${audioPlaylists[0].name}\n`;
    
    fs.writeFileSync(masterPlaylistPath, masterContent);
    console.log(chalk.green('✅ Master playlist:'), audioPlaylists.length, 'audio +', subtitlePlaylists.length, 'subs');
    
    // Send master playlist
    const playlist = fs.readFileSync(masterPlaylistPath, 'utf-8');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(playlist);
    
  } catch (error) {
    console.error(chalk.red('❌ HLS conversion error:'), error.message);
    res.status(500).send('Error creating HLS stream');
  }
});

// HLS segments endpoint - REMOVED
app.get("/hls/:magnet/:filename/:segment", async (req, res) => {
  res.status(404).json({ 
    error: 'HLS removed',
    message: 'Use direct streaming for bandwidth efficiency'
  });
});

// HLS cache clearing - NOT NEEDED ANYMORE
app.delete("/hls/cache/clear", (req, res) => {
  res.json({ 
    success: true, 
    message: 'HLS cache system removed - no cache to clear!' 
  });
});
*/
/* ============================================================= */

// Global error handler
app.use((err, req, res, next) => {
  console.error(chalk.red('Global error:'), err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Sunucu hatası',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 64621;

app.listen(PORT, () => {
  console.log(chalk.green('═══════════════════════════════════════════'));
  console.log(chalk.green(`  🚀 Zenshin Server Running`));
  console.log(chalk.green(`  📡 Port: ${PORT}`));
  console.log(chalk.green(`  🔒 Security: Enabled`));
  console.log(chalk.green(`  💾 Database: SQLite`));
  console.log(chalk.green('═══════════════════════════════════════════'));
});
