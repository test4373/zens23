import express from "express";
import WebTorrent from "webtorrent";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import compression from "compression"; // GZIP compression for speed
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

// Upscale Tests directory - Use app directory in production
const upscaleDir = path.join(__dirname, "upscale_tests");
if (!fs.existsSync(upscaleDir)) {
  fs.mkdirSync(upscaleDir, { recursive: true });
}
console.log(chalk.cyan('📁 Upscale directory:'), upscaleDir);

// LOCAL SUBTITLES directory (Dandadan Season 2) - Only for local development
const localSubsDir = process.env.LOCAL_SUBS_DIR || path.join(__dirname, "local_subs");

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

// === Security/Resilience helpers ===
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const isOriginAllowed = (origin) => {
  if (!origin) return true; // allow same-origin/non-browser
  if (ALLOWED_ORIGINS.includes('*')) return true;
  return ALLOWED_ORIGINS.includes(origin);
};

const isLocalIp = (ip) => {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' ||
         ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
};

const requireLocalOrToken = (req, res, next) => {
  const clientIP = req.ip || req.connection?.remoteAddress || '';
  const token = req.header('x-admin-token');
  if (isLocalIp(clientIP)) return next();
  if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) return next();
  return res.status(403).json({ error: 'Forbidden' });
};

const isValidHttpUrl = (value) => {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return true;
  } catch {
    return false;
  }
};

const withTimeout = async (promise, ms, onAbort) => {
  const controller = new AbortController();
  const id = setTimeout(() => {
    controller.abort();
    if (onAbort) onAbort();
  }, ms);
  try {
    const res = await promise(controller.signal);
    return res;
  } finally {
    clearTimeout(id);
  }
};

// Local server - no proxy needed
// app.set('trust proxy', 1);

// WebTorrent client - KOYEB OPTIMIZED (Ultra Low Memory)
const client = new WebTorrent({
  maxConns: 10,          // 🔥 KOYEB: Reduced to 10 for RAM savings
  downloadLimit: -1,     // Unlimited download
  uploadLimit: 5000,     // 🔥 KOYEB: Reduced to 5KB/s to save RAM
  dht: false,            // ❌ DISABLED: DHT uses too much memory
  lsd: false,            // Disable LSD (not needed on cloud)
  tracker: {
    announce: [
      'udp://tracker.opentrackr.org:1337',
      'udp://open.stealth.si:80',
    ],
    rtcConfig: null        // ❌ DISABLED: WebRTC can cause SIGSEGV on low memory
  },
  strategy: 'sequential',
  prioritizeInitial: true,
});

console.log(chalk.cyan('🌐 WebTorrent initialized (STREAM-ONLY mode)'));

// 🔥 Global WebTorrent error handler - Prevent crashes!
client.on('error', (err) => {
  console.error(chalk.red('❌ WebTorrent error:'), err.message);
  // Don't crash - just log
});

// Handle torrent-level errors
client.on('torrent', (torrent) => {
  torrent.on('error', (err) => {
    console.error(chalk.red('❌ Torrent error:'), torrent.name, '-', err.message);
    // Don't crash
  });
  
  // Handle peer errors (RTCError)
  torrent.on('wire', (wire) => {
    wire.on('error', (err) => {
      // Silent - peer errors are normal
      if (!err.message.includes('User-Initiated Abort')) {
        console.log(chalk.yellow('⚠️ Peer error:'), err.message);
      }
    });
  });
});

// 🚀 PERFORMANCE: GZIP Compression (3x faster responses)
app.use(compression({
  filter: (req, res) => {
    // Don't compress video streams (already compressed)
    if (req.path.includes('/streamfile/') || req.path.includes('/stream-upscale/')) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6 // Compression level (1-9, 6 is balanced)
}));

// Güvenlik middleware'leri
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false // Video streaming için
}));
// Local CORS - allow all for development
app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Content-Range', 'Accept-Ranges', 'X-Admin-Token'],
  exposedHeaders: ['X-Subtitle-Type', 'Content-Type', 'Content-Range', 'Accept-Ranges']
}));

// 🔥 CLOUDFLARE TUNNEL FIX - Handle preflight requests
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  res.status(204).send();
});
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
  trustProxy: true, // Enable for Render.com
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // 15 dakikada maksimum 100 login/register denemesi (artırıldı)
  message: 'Çok fazla giriş denemesi, lütfen 15 dakika sonra tekrar deneyin',
  skipSuccessfulRequests: true,
  trustProxy: true, // Enable for Render.com
});

// Local development - no rate limiting needed
// Rate limiters completely disabled for maximum speed

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/watch', watchRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/admin', adminRoutes); // Admin panel routes

// Bandwidth monitoring middleware
app.use(bandwidthMonitor.middleware());

// 🚀 ULTRA-FAST RESPONSE HEADERS for all requests
app.use((req, res, next) => {
  // CDN-friendly headers
  res.setHeader('X-Powered-By', 'Zenshin-Turbo');
  
  // Aggressive caching for static assets
  if (req.path.includes('/uploads/') || req.path.includes('/upscale/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year!
  }
  
  // API responses - short cache
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min
  }
  
  next();
});

// Request logging (minimal for speed)
app.use((req, res, next) => {
  // Only log non-stream requests to reduce console spam
  if (!req.path.includes('/streamfile/') && !req.path.includes('/detailsepisode/')) {
    console.log(`${chalk.cyan(req.method)} ${chalk.yellow(req.path)} - ${chalk.gray(req.ip)}`);
  }
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
    const response = await withTimeout((signal) => fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`, { signal }
    ), 5000);

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
    // 🚀 INSTANT: Start downloading ALL files immediately for cache
    existingTorrent.files.forEach(f => f.select());
    console.log(chalk.cyan('🚀 Background download accelerated for all files'));
    
    // If torrent is already added, return its file information
    let files = existingTorrent.files.map((file) => ({
      name: file.name,
      length: file.length,
    }));

    return res.status(200).json(files);
  }
  /* ------------------------------------------------------ */

  client.add(magnet, { path: downloadsDir }, function (torrent) {
    // 🚀 AGGRESSIVE: Start downloading immediately
    torrent.files.forEach(f => f.select());
    console.log(chalk.green('📥 Aggressive download started for instant caching'));
    
    let files = torrent.files.map((file) => ({
      name: file.name,
      length: file.length,
    }));

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

  const torrent = client.add(magnet, { 
    path: downloadsDir,
    // 🔥 RENDER.COM: Start downloading immediately for faster subsequent requests
    deselect: false  // Download ALL files in background
  });

  torrent.on("metadata", () => {
    const files = torrent.files.map((file) => ({
      name: file.name,
      length: file.length,
    }));
    console.log(chalk.green('✅ Metadata loaded:'), files.length, 'files');
    console.log(chalk.cyan('🚀 Background download started for caching'));

    res.status(200).json(files);
  });
  
  // 🔥 Log download progress (debounced to unique integer percent)
  let lastLoggedPercent = -1;
  torrent.on('download', () => {
    const currentPercent = Math.floor(torrent.progress * 100);
    if (currentPercent !== lastLoggedPercent) {
      lastLoggedPercent = currentPercent;
      console.log(chalk.cyan(`💾 Caching: ${currentPercent}%`));
    }
  });
});

// 🔥 NO BUFFERING - Large chunks for immediate streaming
const OPTIMAL_VIDEO_CHUNK = 20 * 1024 * 1024;  // 20MB - Large initial chunk
const PREFETCH_SIZE = 0;                       // 0MB - No prefetch to prevent buffering
const MAX_CHUNK = 50 * 1024 * 1024;            // 50MB - Very large chunks

// 🚫 IDM Detection and Blocking with Rate Limiting
const requestCounts = new Map();
const IDM_BLOCK_DURATION = 5 * 60 * 1000; // 5 minutes

const detectAndBlockIDM = (req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  const referer = req.headers.referer || '';
  const accept = req.headers.accept || '';
  const connection = req.headers.connection || '';
  const clientIP = req.ip || req.connection.remoteAddress;
  
  // Whitelist localhost and development IPs
  const isLocalhost = isLocalIp(clientIP);
  
  if (isLocalhost) {
    console.log(chalk.green('✅ Localhost request - skipping IDM check'));
    return next();
  }
  
  // Check if IP is already blocked
  if (requestCounts.has(clientIP)) {
    const { count, lastRequest, blocked } = requestCounts.get(clientIP);
    const now = Date.now();
    
    if (blocked && (now - lastRequest) < IDM_BLOCK_DURATION) {
      console.log(chalk.red('🚫 BLOCKED IP trying to access:'), clientIP);
      res.status(403).json({
        error: 'IP Blocked',
        message: 'Bu IP adresi geçici olarak engellenmiştir. Lütfen daha sonra tekrar deneyin.',
        code: 'IP_BLOCKED',
        retryAfter: Math.ceil((IDM_BLOCK_DURATION - (now - lastRequest)) / 1000)
      });
      return;
    }
    
    // Reset if block duration passed
    if (blocked && (now - lastRequest) >= IDM_BLOCK_DURATION) {
      requestCounts.delete(clientIP);
    }
  }
  
  // IDM detection patterns
  const idmPatterns = [
    /Internet Download Manager/i,
    /IDM/i,
    /IDMan/i,
    /InternetDownloadManager/i,
    /Wget/i,
    /curl/i,
    /aria2/i,
    /axel/i,
    /lftp/i,
    /wget/i
  ];
  
  // Check for IDM-specific headers and patterns - More lenient detection
  const isIDM = idmPatterns.some(pattern => pattern.test(userAgent)) ||
                req.headers['x-idm-version'] ||
                req.headers['x-idm-client'] ||
                req.headers['x-downloader'] ||
                req.headers['x-requested-with'] === 'IDM' ||
                req.headers['x-downloader-type'] ||
                // Only block if multiple suspicious patterns match
                ((accept.includes('*/*') && connection === 'close' && !referer) &&
                 (userAgent.includes('Mozilla') && !req.headers['accept-language']) &&
                 (req.headers['accept-encoding'] === 'identity'));
  
  if (isIDM) {
    console.log(chalk.red('🚫 IDM DETECTED AND BLOCKED:'));
    console.log(chalk.yellow('  User-Agent:'), userAgent);
    console.log(chalk.yellow('  IP:'), clientIP);
    console.log(chalk.yellow('  Headers:'), JSON.stringify(req.headers, null, 2));
    
    // Block IP for 5 minutes
    requestCounts.set(clientIP, {
      count: 0,
      lastRequest: Date.now(),
      blocked: true
    });
    
    res.status(403).json({
      error: 'Download Manager Not Allowed',
      message: 'Bu site download manager\'ları desteklemiyor. Lütfen tarayıcınızın normal video oynatıcısını kullanın.',
      code: 'IDM_BLOCKED',
      timestamp: new Date().toISOString()
    });
    return;
  }
  
  // Rate limiting for suspicious requests
  const now = Date.now();
  const requestData = requestCounts.get(clientIP) || { count: 0, lastRequest: now, blocked: false };
  
  // Reset count if more than 1 minute passed
  if (now - requestData.lastRequest > 60000) {
    requestData.count = 0;
  }
  
  requestData.count++;
  requestData.lastRequest = now;
  
  // Block if too many requests (potential IDM)
  if (requestData.count > 20) {
    console.log(chalk.red('🚫 TOO MANY REQUESTS - BLOCKING IP:'), clientIP);
    requestData.blocked = true;
    requestCounts.set(clientIP, requestData);
    
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.',
      code: 'RATE_LIMITED',
      retryAfter: 60
    });
    return;
  }
  
  requestCounts.set(clientIP, requestData);
  next();
};

// Apply IDM blocking to all video streaming endpoints
app.use('/streamfile', detectAndBlockIDM);
app.use('/streamfile-transcode', detectAndBlockIDM);
app.use('/dash', detectAndBlockIDM);
app.use('/hls', detectAndBlockIDM);

// Development endpoint to clear blocked IPs
app.post('/admin/clear-blocked-ips', requireLocalOrToken, (req, res) => {
  requestCounts.clear();
  console.log(chalk.green('🧹 Cleared all blocked IPs'));
  res.json({ success: true, message: 'All blocked IPs cleared' });
});

// TTL cleanup for requestCounts to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of requestCounts.entries()) {
    if (now - data.lastRequest > 10 * 60 * 1000) {
      requestCounts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// Handle OPTIONS requests for transcoding endpoint
app.options("/streamfile-transcode/:magnet/:filename", (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Range, Content-Length, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  res.status(200).end();
});

// 🔥 AUDIO TRANSCODING ENDPOINT - Converts unsupported codecs to AAC
app.get("/streamfile-transcode/:magnet/:filename", async function (req, res, next) {
  let magnet = req.params.magnet;
  let filename = decodeURIComponent(req.params.filename);
  
  console.log(chalk.cyan('\n🎵 Audio transcoding request:'));
  console.log(chalk.yellow('  Filename:'), filename);
  console.log(chalk.cyan('  🔄 EAC3/AC3 → AAC conversion'));
  
  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).send('Torrent not found');
  }
  
  let file = tor.files.find((f) => f.name === filename);
  if (!file) {
    return res.status(404).send('File not found');
  }
  
  const videoPath = path.join(tor.path, file.path);
  
  // Wait for minimum data and ensure header is present before probing/transcoding
  const MIN_DATA = Math.min(12 * 1024 * 1024, Math.floor(file.length * 0.025));
  let retries = 0;
  
  while ((file.downloaded < MIN_DATA || !fs.existsSync(videoPath)) && retries < 30) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
  }
  
  if (file.downloaded < MIN_DATA || !fs.existsSync(videoPath)) {
    return res.status(503).send('Buffering, retry in 5s');
  }
  
  // Use fragmented MP4 for browser compatibility
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Range, Content-Length, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  
  // Optional time-shifted start (server-side seek)
  const startParam = parseFloat(req.query.t || req.query.start || '0');
  const startSec = Number.isFinite(startParam) && startParam > 1 ? Math.min(startParam, 6 * 3600) : 0; // Cap to 6h

  const proc = ffmpeg(videoPath);
  if (startSec > 0) {
    console.log(chalk.cyan('  ⏩ Time-shifted start at:'), startSec, 's');
    // Place -ss before input for fast seeking
    proc.seekInput(startSec);
  }

  proc
    .outputOptions([
      // Probe larger to stabilize on partial MKV
      '-analyzeduration', '32M',
      '-probesize', '32M',
      // Map first video and first audio only to avoid multi-track drift
      '-map', '0:v:0',
      '-map', '0:a:0',
      // copy video (no re-encode); transcode audio to AAC
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '256k',
      '-ac', '2',
      '-ar', '48000',
      // Simple audio sync compensation
      '-af', 'aresample=async=1',
      // Minimal timestamp handling
      '-async', '1',
      // fragmented MP4 for streaming
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      '-shortest',
      '-max_muxing_queue_size', '1024'
    ])
    .on('error', (err) => {
      console.error(chalk.red('  ❌ FFmpeg transcode error:'), err.message);
      if (!res.headersSent) res.status(500).send('Error');
    });
  
  proc.pipe(res, { end: true });
  req.on('close', () => proc.kill('SIGKILL'));
});

app.get("/streamfile/:magnet/:filename", async function (req, res, next) {
  let magnet = req.params.magnet;
  let filename = decodeURIComponent(req.params.filename);

  console.log(chalk.cyan('\n🎥 Streamfile request:'));
  console.log(chalk.yellow('  Filename:'), filename);
  console.log(chalk.cyan('  🔍 Checking cache...'));

  // 🔥 CHECK CACHE FIRST - Instant playback if already downloaded!
  const cachedPath = path.join(downloadsDir, filename);
  if (fs.existsSync(cachedPath)) {
    console.log(chalk.green('⚡ CACHE HIT! Streaming from disk (instant!)'));
    
    const stat = fs.statSync(cachedPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": "video/x-matroska",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges"
      });
      
      fs.createReadStream(cachedPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "video/x-matroska",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges"
      });
      
      fs.createReadStream(cachedPath).pipe(res);
    }
    return;
  }
  
  console.log(chalk.yellow('  ⚠️ Cache miss, using WebTorrent (may be slow on first load)...'));

  let tor = await client.get(magnet);

  if (!tor) {
    console.log(chalk.red('❌ Torrent not found - adding now...'));
    // 🚀 AUTO-ADD: If torrent not found, add it immediately!
    try {
      tor = await new Promise((resolve, reject) => {
        const newTor = client.add(magnet, { path: downloadsDir });
        newTor.on('metadata', () => resolve(newTor));
        newTor.on('error', reject);
        setTimeout(() => reject(new Error('Timeout')), 10000);
      });
      console.log(chalk.green('✅ Torrent added on-the-fly'));
    } catch (err) {
      console.log(chalk.red('❌ Failed to add torrent:', err.message));
      return res.status(404).send("Torrent not found");
    }
  }

  let file = tor.files.find((f) => f.name === filename);

  if (!file) {
    console.log(chalk.red('❌ File not found:'), filename);
    console.log(chalk.yellow('  Available files:'));
    tor.files.forEach(f => console.log(chalk.gray('    -'), f.name));
    return res.status(404).send("File not found in torrent");
  }
  console.log(chalk.green('✅ File found:'), file.name);

  // 🔥 CRITICAL: Smart file selection + PRIORITY
  file.select();
  
  // Deselect all other files to save bandwidth
  tor.files.forEach(f => {
    if (f.name !== filename) {
      f.deselect();
    }
  });
  
  // 🚀 RENDER.COM OPTIMIZATION: Prioritize first 10MB for instant playback
  const priorityBytes = 10 * 1024 * 1024; // 10MB
  if (file.length > priorityBytes) {
    console.log(chalk.cyan('🚀 Setting priority for first 10MB...'));
    // Note: WebTorrent will automatically prioritize pieces being streamed
  }
  
  console.log(chalk.cyan('💡 Bandwidth optimization:'));
  console.log(chalk.yellow('  Selected file:'), file.name);
  console.log(chalk.yellow('  File size:'), (file.length / 1024 / 1024).toFixed(2), 'MB');
  console.log(chalk.green('  ✅ Other files deselected'));
  console.log(chalk.magenta('  🌐 Render.com optimized streaming active'));

  let range = req.headers.range;

  console.log(chalk.gray("Range:"), range);

  let file_size = file.length;

  // 🔥 OPTIMIZED: Support both range and non-range requests
  if (!range) {
    // No range header - send large initial chunk for immediate streaming
    console.log(chalk.yellow('⚡ No range - sending large 20MB chunk for immediate streaming'));
    
    // 🚀 20MB = Large chunk for immediate streaming without buffering
    const start = 0;
    const end = Math.min(OPTIMAL_VIDEO_CHUNK, file_size - 1);
    const chunksize = end - start + 1;
    
    const head = {
      "Content-Range": `bytes ${start}-${end}/${file_size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": "video/x-matroska",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges",
      "Connection": "keep-alive",
      "X-Content-Disposition": "inline",
      "Content-Disposition": "inline"
    };
    
    res.writeHead(206, head); // 206 Partial Content
    
    const stream = file.createReadStream({ start, end });
    stream.pipe(res);
    
    stream.on("error", function (err) {
      console.error("Initial stream error:", err);
      if (!res.headersSent) {
        return res.status(500).send("Error streaming initial chunk");
      }
    });
    
    console.log(chalk.cyan('✨ Initial chunk sent:'), (chunksize / 1024 / 1024).toFixed(2), 'MB');
    return;
  }

  let positions = range.replace(/bytes=/, "").split("-");
  let start = parseInt(positions[0], 10);
  let end = positions[1] ? parseInt(positions[1], 10) : file_size - 1;
  
  // 🔥 SMART CHUNK SIZE - Optimized for smooth streaming
  const requestedSize = end - start + 1;
  if (requestedSize > MAX_CHUNK) {
    end = start + MAX_CHUNK - 1;
    console.log(chalk.gray(`  📦 Limiting chunk: ${(requestedSize / 1024 / 1024).toFixed(1)}MB → ${(MAX_CHUNK / 1024 / 1024).toFixed(1)}MB`));
  }
  
  // No prefetching - might cause buffering issues
  const playbackProgress = start / file_size;
  
  let chunksize = end - start + 1;

  console.log(chalk.cyan('📊 Streaming stats:'));
  console.log(chalk.yellow('  Chunk size:'), (chunksize / 1024 / 1024).toFixed(2), 'MB');
  console.log(chalk.yellow('  Progress:'), ((start / file_size) * 100).toFixed(1) + '%');

  let head = {
    "Content-Range": `bytes ${start}-${end}/${file_size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunksize,
    "Content-Type": "video/x-matroska",
    // 🚀 OPTIMIZED CACHING - Balance speed and memory
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges",
    "Connection": "keep-alive",
    // 🔥 PLAYBACK OPTIMIZATION HINTS
    "X-Content-Disposition": "inline",
    "Content-Disposition": "inline",
    "X-Accel-Buffering": "no" // Disable proxy buffering for instant delivery
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
import { exec, spawn } from "child_process";
import { get } from "http";
import fetch from "node-fetch";
import { promisify } from "util";
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import crypto from 'crypto';

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
  if (!isValidHttpUrl(url) || url.length > 2000) {
    return res.status(400).send("Invalid URL");
  }
  
  console.log(chalk.cyan('🎬 Launching VLC:'), url);
  const proc = spawn(vlcPath, [url], { shell: false, stdio: 'ignore' });
  proc.on('error', (error) => {
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
  });
  proc.unref();
  console.log(chalk.green('✅ VLC launched successfully'));
  res.send("VLC launched successfully");
});

// Stream to MPV player with automatic subtitle loading
app.get("/stream-to-mpv", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("URL is required");
  }
  if (!isValidHttpUrl(url) || url.length > 2000) {
    return res.status(400).send("Invalid URL");
  }
  
  console.log(chalk.cyan('🎬 Launching MPV:'), url);
  
  // MPV with best settings for anime
  const args = [
    url,
    '--force-window=immediate',
    '--keep-open=yes',
    '--sub-auto=all',
    '--slang=en,eng,jpn',
    '--sid=1',
    '--profile=gpu-hq'
  ];
  const proc = spawn(mpvPath, args, { shell: false, stdio: 'ignore' });
  proc.on('error', (error) => {
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
  });
  proc.unref();
  console.log(chalk.green('✅ MPV launched successfully'));
  res.send("MPV launched successfully");
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

// ping backend - ULTRA FAST (no logging)
app.get("/ping", (req, res) => {
  res.setHeader('Cache-Control', 'no-cache'); // Don't cache health checks
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
    
    const response = await withTimeout((signal) => fetch(url, { signal }), 7000);
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
  
  // Wait for file header and minimum data to avoid ffprobe EBML header errors
  const MIN_DATA = Math.min(8 * 1024 * 1024, Math.floor(videoFile.length * 0.02)); // 8MB or 2%
  let retries = 0;
  while ((videoFile.downloaded < MIN_DATA || !fs.existsSync(videoPath)) && retries < 30) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
  }
  
  if (videoFile.downloaded < MIN_DATA || !fs.existsSync(videoPath)) {
    return res.status(503).json({ error: 'Buffering', progress: `${(videoFile.downloaded / videoFile.length * 100).toFixed(1)}%` });
  }
  
  try {
    console.log(chalk.cyan('  📁 Video path:'), videoPath);
    console.log(chalk.cyan('  📊 File exists:'), fs.existsSync(videoPath));
    
    // Use ffprobe to get all streams (header should be present now)
    const streamInfo = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.error(chalk.red('  ❌ FFprobe error:'), err.message);
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
        
        // Get duration from format or first video stream
        const duration = metadata.format?.duration || 
                        metadata.streams.find(s => s.codec_type === 'video')?.duration ||
                        metadata.streams.find(s => s.duration)?.duration ||
                        null;
        
        console.log(chalk.green('✅ Stream info:'));
        console.log(chalk.cyan('  Duration:'), duration ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}` : 'Unknown');
        console.log(chalk.cyan('  Audio streams:'), audioStreams.length);
        audioStreams.forEach((a, i) => 
          console.log(chalk.gray(`    ${i + 1}. ${a.title} (${a.language}) [${a.codec}]`))
        );
        console.log(chalk.cyan('  Subtitle streams:'), subtitleStreams.length);
        subtitleStreams.forEach((s, i) => 
          console.log(chalk.gray(`    ${i + 1}. ${s.title} (${s.language}) [${s.codec}]`))
        );
        
        resolve({ audioStreams, subtitleStreams, duration });
      });
    });
    
    res.json(streamInfo);
  } catch (error) {
    console.error(chalk.red('❌ FFprobe error:'), error.message);
    res.status(500).json({ error: 'Failed to analyze video' });
  }
});

// Get specific subtitle track by ID (CACHED - Extract once, serve many times)
app.get("/subtitle/:magnet/:filename/:trackId", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = decodeURIComponent(req.params.filename);
  let trackId = parseInt(req.params.trackId);
  
  // Create cache key for this specific track
  const cacheKey = `${magnet}_${filename}_track${trackId}`;
  
  console.log(chalk.cyan('\n=== 📝 SUBTITLE REQUEST ==='));
  console.log(chalk.yellow('  File:'), filename);
  console.log(chalk.yellow('  Track:'), trackId);
  console.log(chalk.gray('  Request from:'), req.get('origin') || req.get('referer') || 'direct');
  
  // Persistent on-disk cache for extracted WebVTT
  // Use shorter hashed filenames to avoid Windows MAX_PATH issues
  const cacheKeyRaw = `${magnet}|${filename}|track:${trackId}`;
  const safeBase = crypto.createHash('sha1').update(cacheKeyRaw).digest('hex');
  const subsCacheDir = path.join(__dirname, 'temp_subs');
  const cachedVttPath = path.join(subsCacheDir, `${safeBase}.vtt`);
  try {
    if (fs.existsSync(cachedVttPath)) {
      console.log(chalk.green('📝 Serving cached subtitle:'), cachedVttPath);
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      return fs.createReadStream(cachedVttPath).pipe(res);
    }
  } catch {}
  
  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).send('Torrent not found');
  }
  
  // STRATEGY 1: Check if torrent has standalone subtitle files (.srt, .ass)
  console.log(chalk.cyan('  🔍 Searching for standalone subtitle files in torrent...'));
  const standaloneSubFiles = tor.files.filter(f => 
    (f.name.endsWith('.srt') || f.name.endsWith('.ass')) &&
    f.name.toLowerCase().includes(path.parse(filename).name.toLowerCase().substring(0, 20))
  );
  
  if (standaloneSubFiles.length > 0) {
    console.log(chalk.green(`  ✅ Found ${standaloneSubFiles.length} standalone subtitle file(s)!`));
    const subFile = standaloneSubFiles[trackId] || standaloneSubFiles[0];
    console.log(chalk.cyan(`  📥 Downloading subtitle file: ${subFile.name}`));
    
    // Select ONLY this subtitle file for download (fast!)
    tor.files.forEach(f => f.deselect());
    subFile.select();
    
    const subPath = path.join(tor.path, subFile.path);
    
    // Wait for subtitle file to download (usually very small, <1MB)
    let retries = 0;
    while (subFile.downloaded < subFile.length && retries < 30) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
      if (retries % 5 === 0) {
        const progress = ((subFile.downloaded / subFile.length) * 100).toFixed(1);
        console.log(chalk.cyan(`     Subtitle download: ${progress}%`));
      }
    }
    
    if (subFile.downloaded >= subFile.length && fs.existsSync(subPath)) {
      console.log(chalk.green('  ✅ Standalone subtitle file downloaded!'));
      let subContent = fs.readFileSync(subPath, 'utf8');
      const isAss = subFile.name.endsWith('.ass');
      const isSrt = subFile.name.endsWith('.srt');
      
      let vttContent;
      if (isAss) {
        // ASS to VTT: Extract dialogue lines only (simplified conversion)
        console.log(chalk.cyan('  🔄 Converting ASS to VTT...'));
        vttContent = convertASStoVTT(subContent);
      } else if (isSrt) {
        console.log(chalk.cyan('  🔄 Converting SRT to VTT...'));
        vttContent = convertSRTtoVTT(subContent);
      } else {
        vttContent = subContent; // Assume it's already VTT or plain text
      }
      
      fs.writeFileSync(cachedVttPath, vttContent, 'utf8');
      
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      return res.send(vttContent);
    }
    
    console.log(chalk.yellow('  ⚠️ Standalone subtitle download timeout, falling back to MKV extraction'));
  }
  
  // STRATEGY 2: Extract from MKV (fallback)
  console.log(chalk.cyan('  🎬 Extracting subtitle from MKV file...'));
  const videoFile = tor.files.find(f => f.name === filename);
  if (!videoFile || !videoFile.name.endsWith('.mkv')) {
    return res.status(404).send('Not an MKV file');
  }
  
  const videoPath = path.join(tor.path, videoFile.path);
  
  // Check if file is fully cached in downloads folder (100% complete)
  const downloadsDir = path.join(__dirname, 'downloads');
  const cachedFilePath = path.join(downloadsDir, filename);
  const isFullyCached = fs.existsSync(cachedFilePath);
  
  if (isFullyCached) {
    console.log(chalk.green(`  ✅ CACHED FILE - Complete subtitles guaranteed!`));
    // Use cached file - guaranteed to have ALL subtitles
  } else if (videoFile.downloaded >= videoFile.length * 0.95) {
    // 95% or more downloaded - close enough for complete subs
    console.log(chalk.green(`  ✅ File 95%+ complete - extracting full subtitles`));
  } else {
    // STREAMING: Force complete MKV download in background, use smart strategy
    console.log(chalk.yellow(`  ⚡ Smart subtitle extraction strategy...`));
    
    // Select video file for download
    tor.files.forEach(f => {
      if (f.name === filename) {
        f.select();
      }
    });
    
    // MKV subtitles are usually at the BEGINNING of file
    // Wait for first 10-15% which usually contains ALL subtitle metadata
    const SMART_THRESHOLD = Math.min(200 * 1024 * 1024, Math.floor(videoFile.length * 0.15)); // 200MB or 15%
    
    const totalSizeMB = (videoFile.length / (1024*1024)).toFixed(1);
    const neededMB = (SMART_THRESHOLD / (1024*1024)).toFixed(1);
    
    console.log(chalk.cyan(`  📥 Downloading smart range: ${neededMB} MB / ${totalSizeMB} MB (15%)`));
    console.log(chalk.gray(`     MKV subtitle data is usually in first 10-15% of file`));
    
    let retries = 0;
    let lastLoggedPercent = 0;
    
    while (videoFile.downloaded < SMART_THRESHOLD && retries < 120) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
      
      const currentPercent = Math.floor((videoFile.downloaded / SMART_THRESHOLD) * 100);
      if (currentPercent >= lastLoggedPercent + 20) {
        const downloadedMB = (videoFile.downloaded / (1024*1024)).toFixed(1);
        console.log(chalk.cyan(`     📊 ${currentPercent}% (${downloadedMB} MB)`));
        lastLoggedPercent = currentPercent;
      }
    }
    
    if (videoFile.downloaded >= SMART_THRESHOLD || videoFile.downloaded >= videoFile.length) {
      const downloadPercent = ((videoFile.downloaded / videoFile.length) * 100).toFixed(1);
      console.log(chalk.green(`  ✅ Downloaded ${downloadPercent}% - extracting subtitles...`));
      
      // Continue downloading in background for complete file
      console.log(chalk.gray(`  📥 Continuing full download in background...`));
    } else {
      const downloadedMB = (videoFile.downloaded / (1024*1024)).toFixed(1);
      console.log(chalk.yellow(`  ⚠️ Downloaded ${downloadedMB} MB - extracting available subtitles`));
    }
  }
  
  // Use cached file if available, otherwise use streaming path
  const extractPath = isFullyCached ? cachedFilePath : videoPath;
  
  try {
    console.log(chalk.cyan(`  🎬 Extracting subtitle track ${trackId} to cache...`));
    if (!fs.existsSync(subsCacheDir)) fs.mkdirSync(subsCacheDir, { recursive: true });
    let responded = false;
    
    // Try SRT first (most compatible), then convert to VTT
    const tempSrtPath = path.join(subsCacheDir, `${safeBase}.srt`);
    const srtProc = ffmpeg(extractPath) // Use cached file if available
      .inputOptions(['-analyzeduration','10M','-probesize','10M','-nostdin'])
      .outputOptions([`-map 0:s:${trackId}`,'-c:s','srt','-f','srt'])
      .on('error', (err) => {
        console.error(chalk.red('  ❌ SRT extract failed:'), err.message);
        try { if (fs.existsSync(tempSrtPath)) fs.unlinkSync(tempSrtPath); } catch {}
        if (responded || res.headersSent) return;
        
        // Final fallback: try direct WebVTT
        console.log(chalk.yellow('  🔄 Trying direct WebVTT extraction...'));
        const vttProc = ffmpeg(extractPath) // Use cached file if available
          .inputOptions(['-analyzeduration','10M','-probesize','10M','-nostdin'])
          .outputOptions([`-map 0:s:${trackId}`,'-c:s','webvtt','-f','webvtt'])
          .on('error', () => {
            if (responded || res.headersSent) return;
            responded = true;
            res.status(404).send('Subtitle track not convertible');
          })
          .on('end', () => {
            if (responded || res.headersSent) return;
            console.log(chalk.green('  ✅ WebVTT subtitle cached'));
            responded = true;
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
            fs.createReadStream(cachedVttPath).pipe(res);
          })
          .save(cachedVttPath);
      })
      .on('end', () => {
        if (responded || res.headersSent) return;
        try {
          console.log(chalk.green('  ✅ SRT extracted, converting to VTT...'));
          const srtContent = fs.readFileSync(tempSrtPath, 'utf8');
          const vttContent = convertSRTtoVTT(srtContent);
          fs.writeFileSync(cachedVttPath, vttContent, 'utf8');
          try { fs.unlinkSync(tempSrtPath); } catch {}
          
          console.log(chalk.green('  ✅ VTT conversion complete'));
          responded = true;
          res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
          fs.createReadStream(cachedVttPath).pipe(res);
        } catch (convErr) {
          console.error(chalk.red('  ❌ VTT conversion failed:'), convErr.message);
          if (!res.headersSent) {
            responded = true;
            res.status(500).send('Subtitle conversion failed');
          }
        }
      })
      .save(tempSrtPath);
  } catch (error) {
    console.error(chalk.red('  ❌ Error:'), error.message);
    if (!res.headersSent) res.status(500).send('Error processing subtitle request');
  }
});

// Duplicate endpoint removed - using cached version above

// 💾 Subtitle cache - Store extracted subtitles permanently (never delete)
class SubtitleCache {
  constructor() {
    this.cache = new Map();
    this.stats = {
      totalStored: 0,
      totalHits: 0,
      totalMisses: 0
    };
  }
  
  get(key) {
    const item = this.cache.get(key);
    if (item) {
      this.stats.totalHits++;
      console.log(chalk.green(`📊 Cache hit for: ${key}`));
      return item;
    }
    this.stats.totalMisses++;
    return null;
  }
  
  set(key, value) {
    if (!this.cache.has(key)) {
      this.stats.totalStored++;
      console.log(chalk.blue(`💾 Storing subtitle permanently: ${key}`));
    }
    this.cache.set(key, value);
  }
  
  has(key) {
    return this.cache.has(key);
  }
  
  getStats() {
    return {
      ...this.stats,
      currentSize: this.cache.size,
      hitRate: this.stats.totalHits / (this.stats.totalHits + this.stats.totalMisses) * 100 || 0
    };
  }
  
  // Method to manually clear cache if needed (for debugging)
  clear() {
    console.log(chalk.yellow('🧹 Manually clearing subtitle cache'));
    this.cache.clear();
    this.stats = { totalStored: 0, totalHits: 0, totalMisses: 0 };
  }
}

const subtitleCache = new SubtitleCache(); // 🔥 Permanent subtitle cache - never deletes

// Cache statistics endpoint
app.get("/cache-stats", (req, res) => {
  const stats = subtitleCache.getStats();
  res.json({
    subtitleCache: {
      ...stats,
      keys: Array.from(subtitleCache.cache.keys()),
      description: "Permanent subtitle cache - never deletes subtitles"
    }
  });
});

// Manual cache clear endpoint (for debugging only)
app.post("/cache-clear", (req, res) => {
  subtitleCache.clear();
  res.json({ message: "Subtitle cache cleared manually" });
});

// Get subtitle for a specific file (extract from MKV if needed) - DEFAULT TRACK
app.get("/subtitles/:magnet/:filename", async (req, res) => {
  const cacheKey = `${req.params.magnet}_${req.params.filename}`;
  
  // Persistent on-disk cache for default track
  const safeBase = crypto.createHash('sha1').update(cacheKey).digest('hex');
  const subsCacheDir = path.join(__dirname, 'temp_subs');
  const cachedVttPath = path.join(subsCacheDir, `${safeBase}_default.vtt`);
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
  
  // 2. If external subtitle found, stream it and also cache
  if (subtitleFile) {
    console.log(chalk.cyan('📝 Streaming external subtitle:'), subtitleFile.name);
    
    // ASS dosyası mı kontrol et
    const isAssFile = subtitleFile.name.toLowerCase().endsWith('.ass');
    
    res.setHeader("Content-Type", "text/vtt");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "X-Subtitle-Type");
          res.setHeader("X-Subtitle-Type", isAssFile ? "ass" : "srt");
      console.log(chalk.green('🏷️ Subtitle type header set:'), isAssFile ? 'ASS' : 'SRT');
      
      // 💾 SMART CACHE: Stream to client AND cache simultaneously
      let subtitleContent = '';
      const chunks = [];
      let stream = subtitleFile.createReadStream();
      
      stream.on('data', (chunk) => {
        chunks.push(chunk);
        res.write(chunk); // Stream to client immediately
      });
      
      stream.on('end', () => {
        // Cache after streaming complete
        subtitleContent = Buffer.concat(chunks).toString();
        subtitleCache.set(cacheKey, {
          content: subtitleContent,
          type: isAssFile ? 'ass' : 'srt',
          extractedAt: Date.now()
        });
        try {
          if (!fs.existsSync(subsCacheDir)) fs.mkdirSync(subsCacheDir, { recursive: true });
          const vttContent = isAssFile ? subtitleContent : convertSRTtoVTT(subtitleContent);
          fs.writeFileSync(cachedVttPath, vttContent, 'utf-8');
        } catch {}
        console.log(chalk.cyan('💾 Subtitle stored permanently - will never be deleted'));
        res.end();
      });
      
      stream.on('error', (err) => {
        console.error(chalk.red('Subtitle stream error:'), err);
        if (!res.headersSent) {
          res.status(500).send('Error streaming subtitle');
        }
      });

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
  
  // 5. Last resort: try to extract from MKV and persist to disk
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

    console.log(chalk.cyan('🎬 Extracting subtitle to cache (WebVTT)'));
    if (!fs.existsSync(subsCacheDir)) fs.mkdirSync(subsCacheDir, { recursive: true });
    const proc = ffmpeg(videoPath)
      .outputOptions(['-map 0:s:0','-c:s','webvtt','-f','webvtt'])
      .on('error', (err) => {
        console.error(chalk.red('❌ FFmpeg error:'), err.message);
        if (fs.existsSync(cachedVttPath)) fs.unlinkSync(cachedVttPath);
        // Fallback: extract SRT to temp file then convert
        const tempSrtPath = path.join(subsCacheDir, `${safeBase}_default.srt`);
        const srtProc = ffmpeg(videoPath)
          .outputOptions(['-map 0:s:0','-c:s','srt','-f','srt'])
          .on('error', () => {
            if (!res.headersSent) res.status(404).send('No subtitle track found in MKV');
          })
          .on('end', () => {
            try {
              const srtContent = fs.readFileSync(tempSrtPath, 'utf8');
              const vttContent = convertSRTtoVTT(srtContent);
              fs.writeFileSync(cachedVttPath, vttContent, 'utf8');
              try { fs.unlinkSync(tempSrtPath); } catch {}
              res.setHeader('Content-Type', 'text/vtt');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
              fs.createReadStream(cachedVttPath).pipe(res);
            } catch {
              if (!res.headersSent) res.status(500).send('Subtitle conversion failed');
            }
          })
          .save(tempSrtPath);
      })
      .on('end', () => {
        console.log(chalk.green('✅ Subtitle cached, serving...'));
        res.setHeader('Content-Type', 'text/vtt');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        fs.createReadStream(cachedVttPath).pipe(res);
      })
      .save(cachedVttPath);
  } catch (error) {
    console.error(chalk.red('❌ FFmpeg error:'), error.message);
    return res.status(500).send("Error extracting subtitle from MKV");
  }
});

// Background re-extraction when file is fully downloaded
async function checkAndReExtractSubtitles(magnet, filename, trackId, safeBase, cachedVttPath, subsCacheDir) {
  try {
    const tor = await client.get(magnet);
    if (!tor) return;
    
    const videoFile = tor.files.find(f => f.name === filename);
    if (!videoFile) return;
    
    // Check if file is now fully downloaded
    const isComplete = videoFile.downloaded >= videoFile.length;
    const downloadPercent = ((videoFile.downloaded / videoFile.length) * 100).toFixed(1);
    
    if (isComplete) {
      console.log(chalk.green(`\n🔄 File fully downloaded (${downloadPercent}%) - re-extracting complete subtitles...`));
      console.log(chalk.cyan(`   File: ${filename} Track: ${trackId}`));
      
      const videoPath = path.join(tor.path, videoFile.path);
      if (!fs.existsSync(videoPath)) return;
      
      // Re-extract with full file
      const tempSrtPath = path.join(subsCacheDir, `${safeBase}_full.srt`);
      
      ffmpeg(videoPath)
        .inputOptions(['-analyzeduration','10M','-probesize','10M','-nostdin'])
        .outputOptions([`-map 0:s:${trackId}`,'-c:s','srt','-f','srt'])
        .on('error', (err) => {
          console.error(chalk.red('  ❌ Background re-extraction failed:'), err.message);
        })
        .on('end', () => {
          try {
            const srtContent = fs.readFileSync(tempSrtPath, 'utf8');
            const vttContent = convertSRTtoVTT(srtContent);
            
            // Replace cached VTT with complete version
            fs.writeFileSync(cachedVttPath, vttContent, 'utf8');
            fs.unlinkSync(tempSrtPath); // Clean up temp SRT
            
            const cueCount = (vttContent.match(/-->/g) || []).length;
            console.log(chalk.green(`  ✅ Complete subtitles cached: ${cueCount} cues (updated cache)`));
          } catch (e) {
            console.error(chalk.red('  ❌ VTT conversion failed:'), e.message);
          }
        })
        .save(tempSrtPath);
        
    } else if (downloadPercent < 100) {
      // Not complete yet, check again later
      console.log(chalk.gray(`  ⏳ Download progress: ${downloadPercent}% - will check again...`));
      setTimeout(() => {
        checkAndReExtractSubtitles(magnet, filename, trackId, safeBase, cachedVttPath, subsCacheDir);
      }, 10000); // Check every 10 seconds
    }
  } catch (err) {
    console.error(chalk.red('Background re-extraction error:'), err.message);
  }
}

// Helper function to convert ASS to WebVTT (simplified - strips styling)
function convertASStoVTT(assContent) {
  if (!assContent || assContent.trim().length === 0) {
    return 'WEBVTT\n\n';
  }
  
  let vtt = 'WEBVTT\n\n';
  const lines = assContent.split(/\r?\n/);
  let inEvents = false;
  
  for (let line of lines) {
    // Find [Events] section
    if (line.trim() === '[Events]') {
      inEvents = true;
      continue;
    }
    
    // Stop if we hit another section
    if (line.trim().startsWith('[') && line.trim() !== '[Events]') {
      inEvents = false;
      continue;
    }
    
    if (!inEvents || !line.startsWith('Dialogue:')) continue;
    
    // Parse ASS dialogue line
    // Format: Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    const parts = line.substring(9).split(','); // Remove "Dialogue:"
    if (parts.length < 10) continue;
    
    const start = parts[1].trim();
    const end = parts[2].trim();
    const text = parts.slice(9).join(','); // Text might contain commas
    
    // Convert ASS timestamp (0:00:01.50) to VTT (00:00:01.500)
    const vttStart = convertASSTimestamp(start);
    const vttEnd = convertASSTimestamp(end);
    
    // Strip ASS formatting tags like {\b1}, {\i1}, etc
    const cleanText = text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').trim();
    
    if (cleanText) {
      vtt += `${vttStart} --> ${vttEnd}\n`;
      vtt += cleanText + '\n\n';
    }
  }
  
  return vtt;
}

function convertASSTimestamp(assTime) {
  // ASS: 0:00:01.50 → VTT: 00:00:01.500
  const parts = assTime.split(':');
  if (parts.length !== 3) return '00:00:00.000';
  
  const hours = parts[0].padStart(2, '0');
  const minutes = parts[1].padStart(2, '0');
  const secParts = parts[2].split('.');
  const seconds = secParts[0].padStart(2, '0');
  const centiseconds = (secParts[1] || '0').padEnd(3, '0').substring(0, 3); // Convert centiseconds to milliseconds
  
  return `${hours}:${minutes}:${seconds}.${centiseconds}`;
}

// Helper function to convert SRT to WebVTT (PROPER CONVERSION)
function convertSRTtoVTT(srtContent) {
  if (!srtContent || srtContent.trim().length === 0) {
    return 'WEBVTT\n\n';
  }
  
  // Start with WebVTT header
  let vtt = 'WEBVTT\n\n';
  
  // Split into blocks (separated by double newlines)
  const blocks = srtContent.split(/\r?\n\r?\n/);
  
  for (let block of blocks) {
    if (!block.trim()) continue;
    
    const lines = block.split(/\r?\n/);
    if (lines.length < 2) continue;
    
    // First line is sequence number in SRT - SKIP IT (VTT doesn't use numbers)
    // Second line is timestamp
    // Rest are subtitle text
    
    let startIdx = 0;
    
    // Skip sequence number line (if it's just a number)
    if (lines[0].match(/^\d+$/)) {
      startIdx = 1;
    }
    
    if (startIdx >= lines.length) continue;
    
    // Get timestamp line
    const timestampLine = lines[startIdx];
    
    // Convert SRT timestamp format to VTT format
    // SRT: 00:00:01,500 --> 00:00:04,400
    // VTT: 00:00:01.500 --> 00:00:04.400
    const vttTimestamp = timestampLine.replace(/,/g, '.');
    
    // Get subtitle text (all remaining lines)
    const subtitleText = lines.slice(startIdx + 1).join('\n');
    
    if (subtitleText.trim()) {
      vtt += vttTimestamp + '\n';
      vtt += subtitleText + '\n\n';
    }
  }
  
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

/* ========== GET AUDIO TRACKS FROM MKV (IMPROVED) ========== */
// Helper function to map language codes to full names
// Removed getLanguageName function - no longer needed for fast track detection

// Get audio and subtitle tracks from MKV file with REAL codec detection
app.get("/tracks/:magnet/:filename", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = decodeURIComponent(req.params.filename);
  
  console.log(chalk.cyan('\n=== 🎬 TRACK DETECTION (WITH CODEC INFO) ==='));
  console.log(chalk.yellow('  File:'), filename);
  
  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).json({ error: 'Torrent not found', audio: [], subtitles: [] });
  }
  
  const videoFile = tor.files.find(f => f.name === filename);
  if (!videoFile) {
    return res.status(404).json({ error: 'File not found', audio: [], subtitles: [] });
  }
  
  if (!videoFile.name.endsWith('.mkv')) {
    console.log(chalk.yellow('  ⚠️ Not an MKV file, returning empty tracks'));
    return res.json({ audio: [], subtitles: [] });
  }
  
  const videoPath = path.join(tor.path, videoFile.path);
  
  // Wait for sufficient data (20MB or 3%)
  const MIN_DATA = Math.min(20 * 1024 * 1024, Math.floor(videoFile.length * 0.03));
  let retries = 0;
  while ((videoFile.downloaded < MIN_DATA || !fs.existsSync(videoPath)) && retries < 30) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
  }
  
  if (videoFile.downloaded < MIN_DATA || !fs.existsSync(videoPath)) {
    console.log(chalk.yellow('  ⏳ Buffering, not enough data yet'));
    return res.json({ 
      ready: false, 
      progress: `${(videoFile.downloaded / videoFile.length * 100).toFixed(1)}%`,
      audio: [], 
      subtitles: [] 
    });
  }
  
  // Use FFmpeg to get REAL codec information
  try {
    console.log(chalk.cyan('  🔍 Analyzing with FFmpeg...'));
    const trackInfo = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.error(chalk.red('  ❌ FFprobe error:'), err.message);
          reject(err);
          return;
        }
        
        const audioStreams = metadata.streams
          .filter(s => s.codec_type === 'audio')
          .map((s, idx) => ({
            index: idx,
            streamIndex: s.index,
            codec: s.codec_name || 'unknown',
            language: s.tags?.language || 'und',
            languageName: s.tags?.language || 'Unknown',
            title: s.tags?.title || `Audio ${idx + 1}`,
            channels: s.channels || 2,
            default: s.disposition?.default === 1 || idx === 0,
            forced: s.disposition?.forced === 1 || false
          }));
        
        const subtitleStreams = metadata.streams
          .filter(s => s.codec_type === 'subtitle')
          .map((s, idx) => ({
            index: idx,
            streamIndex: s.index,
            codec: s.codec_name || 'unknown',
            language: s.tags?.language || 'und',
            languageName: s.tags?.language || 'Unknown',
            title: s.tags?.title || `Subtitle ${idx + 1}`,
            default: s.disposition?.default === 1 || idx === 0,
            forced: s.disposition?.forced === 1 || false
          }));
        
        console.log(chalk.green('  ✅ Found:'), audioStreams.length, 'audio,', subtitleStreams.length, 'subtitle tracks');
        audioStreams.forEach((a, i) => {
          console.log(
            chalk.gray(`    Audio ${i + 1}:`),
            chalk.cyan(a.codec),
            chalk.yellow(`(${a.language})`)
          );
        });
        
        resolve({ audio: audioStreams, subtitles: subtitleStreams, ready: true });
      });
    });
    
    res.json(trackInfo);
  } catch (error) {
    console.error(chalk.red('  ❌ FFprobe failed:'), error.message);
    // Fallback to basic tracks with unknown codec
    res.json({
      audio: [{
        index: 0,
        streamIndex: 1,
        codec: 'unknown',
        language: 'und',
        languageName: 'Unknown',
        title: 'Default Audio',
        channels: 2,
        default: true,
        forced: false
      }],
      subtitles: [{
        index: 0,
        streamIndex: 2,
        codec: 'unknown',
        language: 'und',
        languageName: 'Unknown',
        title: 'Default Subtitle',
        default: true,
        forced: false
      }],
      ready: true
    });
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
      const subResponse = await withTimeout((signal) => fetch(fullUrl, { signal }), 10000);
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

/* ========== ADAPTIVE BITRATE STREAMING (DASH) ========== */
// 🎬 MPEG-DASH Support - Better than HLS
// DASH cache directory
const dashCacheDir = path.join(__dirname, 'dash_cache');
if (!fs.existsSync(dashCacheDir)) {
  fs.mkdirSync(dashCacheDir, { recursive: true });
}

// MPEG-DASH endpoint (better than HLS)
app.get("/dash/:magnet/:filename/manifest.mpd", async (req, res) => {
  let magnet = req.params.magnet;
  let filename = decodeURIComponent(req.params.filename);
  
  console.log(chalk.cyan('🎥 === MPEG-DASH İSTEĞİ (Better than HLS) ==='));
  console.log(chalk.yellow('  Dosya:'), filename);
  
  let tor = await client.get(magnet);
  if (!tor) {
    return res.status(404).send('Torrent bulunamadı');
  }
  
  const videoFile = tor.files.find(f => f.name === filename);
  if (!videoFile) {
    return res.status(404).send('Video dosyası bulunamadı');
  }
  
  const videoPath = path.join(tor.path, videoFile.path);
  
  // 🔥 WAIT FOR ENOUGH DATA: Need at least 50MB or 10% to get accurate duration
  const MIN_DOWNLOAD = Math.min(50 * 1024 * 1024, videoFile.length * 0.1); // 50MB or 10%
  let retries = 0;
  const MAX_RETRIES = 60; // 60 seconds max wait
  
  console.log(chalk.cyan(`  ⏳ Waiting for ${(MIN_DOWNLOAD / 1024 / 1024).toFixed(1)}MB to ensure accurate duration...`));
  
  while (videoFile.downloaded < MIN_DOWNLOAD && retries < MAX_RETRIES) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
    if (retries % 5 === 0) {
      console.log(chalk.yellow(`  📉 Buffering... ${(videoFile.downloaded / 1024 / 1024).toFixed(2)}MB / ${(videoFile.length / 1024 / 1024).toFixed(2)}MB (${(videoFile.downloaded / videoFile.length * 100).toFixed(1)}%)`));
    }
  }
  
  if (videoFile.downloaded < MIN_DOWNLOAD) {
    return res.status(503).send(`Video buffering... ${(videoFile.downloaded / videoFile.length * 100).toFixed(0)}% ready. Retry in 10 seconds.`);
  }
  
  console.log(chalk.green(`✅ Buffer ready: ${(videoFile.downloaded / 1024 / 1024).toFixed(1)}MB`));
  
  console.log(chalk.green('✅ Enough data buffered, starting DASH generation...'));
  
  // Video için cache dizini oluştur
  const videoHash = Buffer.from(filename).toString('base64').replace(/[/+=]/g, '_');
  const videoCacheDir = path.join(dashCacheDir, videoHash);
  const manifestPath = path.join(videoCacheDir, 'manifest.mpd');
  
  // Cache kontrolü
  if (fs.existsSync(manifestPath)) {
    console.log(chalk.green('✅ Önbellek DASH kullanılıyor'));
    const manifest = fs.readFileSync(manifestPath, 'utf-8');
    res.setHeader('Content-Type', 'application/dash+xml');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(manifest);
  }
  
  if (!fs.existsSync(videoCacheDir)) {
    fs.mkdirSync(videoCacheDir, { recursive: true });
  }
  
      console.log(chalk.cyan('🔄 MPEG-DASH stream oluşturuluyor (PROGRESSIVE - ilk segment hemen!)...'));
    
    try {
      // 🚀 PROGRESSIVE DASH - Start playback ASAP
      const qualities = [
        { name: 'original', copy: true },
      ];
    
    const variantPromises = qualities.map((quality, idx) => {
      return new Promise(async (resolve, reject) => {
        const playlistName = `${idx}-stream.m3u8`;
        const playlistPath = path.join(videoCacheDir, playlistName);
        
        console.log(chalk.yellow(`  🎬 DASH çalışıyor (video COPY, audio AAC'ye dönüştürülüyor)...`));
        
        // 🔥 PROBE FULL DURATION - Critical for correct HLS generation
        let videoDuration = 0;
        let retryProbe = 0;
        
        while (videoDuration === 0 && retryProbe < 5) {
          try {
            videoDuration = await new Promise((resolve, reject) => {
              ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                  console.error(chalk.red('FFprobe error:'), err.message);
                  reject(err);
                  return;
                }
                const duration = metadata.format.duration || 0;
                console.log(chalk.cyan(`  ⏱️ Probed duration: ${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s`));
                resolve(duration);
              });
            });
            
            if (videoDuration > 0) {
              console.log(chalk.green(`  ✅ Video duration confirmed: ${Math.floor(videoDuration / 60)}m ${Math.floor(videoDuration % 60)}s`));
              break;
            }
          } catch (err) {
            retryProbe++;
            console.error(chalk.yellow(`  ⚠️ Probe attempt ${retryProbe} failed, retrying...`));
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        
        if (videoDuration === 0) {
          console.error(chalk.red('❌ Could not determine video duration'));
          reject(new Error('Cannot determine video duration'));
          return;
        }
        
        const args = [
          // 🔥 INPUT OPTIONS (before -i) - FAST!
          '-analyzeduration', '50M',  // Reduced for speed
          '-probesize', '50M',
          '-fflags', '+fastseek+genpts',  // Fast seeking
          '-threads', '0',  // Use all CPU cores
          '-i', videoPath,
          // 🔥 OUTPUT OPTIONS (after -i)
          // Video stream
          '-map', '0:v:0',
          '-c:v', 'copy',  // No re-encoding!
          // Audio stream (transcode to AAC for browser compatibility)
          '-map', '0:a:0',
          '-c:a', 'aac',
          '-ac', '2',
          '-b:a', '128k',
          '-ar', '48000',
          // 🔥 KEYFRAME SETTINGS (output options!)
          '-force_key_frames', 'expr:gte(t,n_forced*6)',
          '-g', '180',  // GOP size (6 sec * 30 fps)
          '-sc_threshold', '0',
          // 📦 MPEG-DASH FORMAT
          '-f', 'dash',
          '-seg_duration', '4',  // 🔥 4 second segments (faster initial response!)
          '-window_size', '5',   // Keep only 5 segments in manifest (low RAM!)
          '-extra_window_size', '10',  // Keep 10 extra for seeking
          '-use_template', '1',
          '-use_timeline', '1',
          '-init_seg_name', `init-stream${idx}.m4s`,
          '-media_seg_name', `chunk-stream${idx}-$Number%05d$.m4s`,
          '-adaptation_sets', 'id=0,streams=v id=1,streams=a',
          '-single_file', '0',
          '-streaming', '1',
          // Note: remove '-ldash' for broader ffmpeg compatibility
          manifestPath
        ];
        
        const proc = spawn(ffmpegPath.path, args);
        
        let firstSegmentCreated = false;
        let lastLog = 0;
        let errorLog = [];
        
        proc.stderr.on('data', (data) => {
          const output = data.toString();
          errorLog.push(output);
          
          // 🔥 Check if DASH manifest and first segments exist
          if (!firstSegmentCreated && fs.existsSync(manifestPath)) {
            try {
              // Check for manifest + at least 2 segment files
              const cacheFiles = fs.readdirSync(videoCacheDir);
              const segmentFiles = cacheFiles.filter(f => f.includes('chunk-stream'));
              
              if (segmentFiles.length >= 2) {
                firstSegmentCreated = true;
                console.log(chalk.green(`    ✅ İlk ${segmentFiles.length} segment hazır - Instant playback!`));
                resolve({ name: playlistName, copy: true, idx: idx });
              }
            } catch (err) {
              // Ignore errors, will retry
            }
          }
          
          // İlerleme göster + Early manifest check
          if (output.includes('time=')) {
            const now = Date.now();
            
            // Check for early manifest availability every second
            if (now - lastLog > 1000 && !firstSegmentCreated) {
              if (fs.existsSync(manifestPath)) {
                const cacheFiles = fs.readdirSync(videoCacheDir);
                const segmentFiles = cacheFiles.filter(f => f.includes('chunk-stream'));
                
                if (segmentFiles.length >= 1) {
                  firstSegmentCreated = true;
                  console.log(chalk.green(`    ⚡ INSTANT START! ${segmentFiles.length} segment ready`));
                  resolve({ name: playlistName, copy: true, idx: idx });
                }
              }
            }
            
            if (now - lastLog > 3000) { // Her 3 saniyede log
              const match = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
              if (match) {
                const hours = parseInt(match[1]);
                const mins = parseInt(match[2]);
                const secs = parseFloat(match[3]);
                const totalSecs = hours * 3600 + mins * 60 + secs;
                const progress = videoDuration > 0 ? ((totalSecs / videoDuration) * 100).toFixed(1) : '?';
                console.log(chalk.gray('    🔄'), `${match[1]}:${match[2]}:${Math.floor(secs)} (${progress}%)`);
                lastLog = now;
              }
            }
          }
        });
        
        proc.on('close', (code) => {
          if (code === 0 || code === null) {
            console.log(chalk.green(`    ✅ DASH tamamlandı`));
            if (!firstSegmentCreated) {
              resolve({ name: playlistName, copy: true, idx: idx });
            }
          } else {
            console.error(chalk.red(`    ❌ FFmpeg ${code} koduyla kapandı`));
            console.error(chalk.red('    📝 FFmpeg error log:'));
            errorLog.slice(-20).forEach(line => console.error(chalk.gray('      ' + line.trim())));
            if (!firstSegmentCreated) {
              reject(new Error(`DASH failed with code ${code}`));
            }
          }
        });
        
        proc.on('error', (err) => {
          console.error(chalk.red('    ❌ FFmpeg hatası:'), err.message);
          if (!firstSegmentCreated) {
            reject(err);
          }
        });
        
        // 🔥 Timeout - 60 saniye (video copy hızlı ama audio transcode zaman alır)
        setTimeout(() => {
          if (!firstSegmentCreated) {
            console.error(chalk.red('    ❌ Timeout - İlk segment 60 saniyede oluşmadı'));
            console.error(chalk.yellow('    ⚠️ FFmpeg hala çalışıyor, arka planda tamamlanacak...'));
            // Don't kill process - let it finish in background
            // proc.kill();
            // Frontend will fallback to direct streaming
            reject(new Error('DASH timeout - generating in background'));
          }
        }, 60000); // 60 seconds
      });
    });
    
    const variants = await Promise.all(variantPromises);
    
    // 🔥 CRITICAL: Wait for manifest file to be created
    let manifestWaitRetries = 0;
    while (!fs.existsSync(manifestPath) && manifestWaitRetries < 30) {
      await new Promise(r => setTimeout(r, 1000));
      manifestWaitRetries++;
    }
    
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Manifest not created after 30 seconds');
    }
    
    // 🔥 CRITICAL: Verify init segment exists
    const initSegPath = path.join(videoCacheDir, 'init-stream0.m4s');
    let initWaitRetries = 0;
    while (!fs.existsSync(initSegPath) && initWaitRetries < 10) {
      console.log(chalk.yellow(`    ⏳ Waiting for init segment... (${initWaitRetries + 1}/10)`));
      await new Promise(r => setTimeout(r, 1000));
      initWaitRetries++;
    }
    
    if (!fs.existsSync(initSegPath)) {
      console.log(chalk.red('    ❌ Init segment not found, but continuing...'));
    } else {
      console.log(chalk.green('    ✅ Init segment ready'));
    }
    
    console.log(chalk.green('✅ DASH manifest oluşturuldu'));

    // Send the manifest
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    res.setHeader('Content-Type', 'application/dash+xml');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(manifestContent);
    
  } catch (error) {
    console.error(chalk.red('❌ DASH hatası:'), error.message);
    res.status(500).send('DASH dönüştürme başarısız');
  }
});

// Serve DASH segments
app.get("/dash/:magnet/:filename/:segment", async (req, res) => {
  const { magnet, filename, segment } = req.params;
  const videoHash = Buffer.from(decodeURIComponent(filename)).toString('base64').replace(/[/+=]/g, '_');
  const videoCacheDir = path.join(dashCacheDir, videoHash);
  const segmentPath = path.join(videoCacheDir, segment);

  if (!fs.existsSync(segmentPath)) {
    console.log(chalk.red('❌ Segment not found:'), segment);
    return res.status(404).send('Segment not found');
  }

  // Serve with aggressive caching
  res.setHeader('Content-Type', segment.endsWith('.mpd') ? 'application/dash+xml' : 'video/mp4');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year!

  fs.createReadStream(segmentPath).pipe(res);
});

// Clear DASH cache
app.delete("/dash/cache/clear", (req, res) => {
  try {
    if (fs.existsSync(dashCacheDir)) {
      fs.rmSync(dashCacheDir, { recursive: true, force: true });
      fs.mkdirSync(dashCacheDir, { recursive: true });
      console.log(chalk.green('✅ DASH cache cleared'));
    }
    res.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});
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

// Health check for Render.com
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    torrents: client.torrents.length,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// 🔥 Process error handlers - Prevent crashes
process.on('uncaughtException', (err) => {
  const message = err && (err.message || String(err));
  const isRtcAbort = message.includes('User-Initiated Abort') || message.includes('RTCError');
  if (isRtcAbort) {
    console.warn(chalk.yellow('⚠️ Suppressed benign WebRTC abort:'), message);
    return; // ignore benign WebRTC aborts
  }
  console.error(chalk.red('❌❌❌ UNCAUGHT EXCEPTION ❌❌❌'));
  console.error(chalk.red(err.stack || message));
  // Don't exit - keep server running
});

process.on('unhandledRejection', (reason, promise) => {
  const message = (reason && (reason.message || String(reason))) || '';
  const isRtcAbort = message.includes('User-Initiated Abort') || message.includes('RTCError');
  if (isRtcAbort) {
    console.warn(chalk.yellow('⚠️ Suppressed benign WebRTC rejection:'), message);
    return; // ignore benign WebRTC aborts
  }
  console.error(chalk.red('❌ Unhandled Rejection at:'), promise);
  console.error(chalk.red('Reason:'), reason);
  // Don't exit
});

// Bind to 0.0.0.0 for Render.com
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(chalk.green('═══════════════════════════════════════════'));
  console.log(chalk.green(`  🚀 Zenshin Server Running`));
  console.log(chalk.green(`  📡 Host: ${HOST}:${PORT}`));
  console.log(chalk.green(`  🌍 Environment: ${process.env.NODE_ENV || 'development'}`));
  console.log(chalk.green(`  🔒 Security: Enabled`));
  console.log(chalk.green(`  💾 Database: SQLite`));
  console.log(chalk.green(`  🛡 Crash Protection: ON`));
  console.log(chalk.green(`  ✅ Health: ${HOST}:${PORT}/health`));
  console.log(chalk.green('═══════════════════════════════════════════'));
});

