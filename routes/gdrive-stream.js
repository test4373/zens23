const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const chalk = require('chalk');

// Google Drive API setup
let drive = null;
let isAuthenticated = false;

/**
 * Initialize Google Drive API
 * Credentials dosyası yoksa manuel auth kullan
 */
const initDrive = async () => {
  try {
    // Service Account kullan (credentials.json)
    const auth = new google.auth.GoogleAuth({
      keyFile: './gdrive-credentials.json',
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    const authClient = await auth.getClient();
    drive = google.drive({ version: 'v3', auth: authClient });
    isAuthenticated = true;
    
    console.log(chalk.green('✅ Google Drive API authenticated'));
    return true;
  } catch (error) {
    console.log(chalk.yellow('⚠️ Service Account auth failed, trying OAuth...'));
    
    // Fallback: OAuth2 (kullanıcı token'ı)
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GDRIVE_CLIENT_ID,
        process.env.GDRIVE_CLIENT_SECRET,
        process.env.GDRIVE_REDIRECT_URI || 'http://localhost:64621/auth/google/callback'
      );

      // Token varsa yükle
      if (process.env.GDRIVE_REFRESH_TOKEN) {
        oauth2Client.setCredentials({
          refresh_token: process.env.GDRIVE_REFRESH_TOKEN
        });
        
        drive = google.drive({ version: 'v3', auth: oauth2Client });
        isAuthenticated = true;
        
        console.log(chalk.green('✅ Google Drive OAuth authenticated'));
        return true;
      } else {
        console.log(chalk.red('❌ No refresh token found. Please authenticate first.'));
        return false;
      }
    } catch (oauthError) {
      console.error(chalk.red('❌ OAuth authentication failed:'), oauthError.message);
      return false;
    }
  }
};

/**
 * Stream video from Google Drive with range support
 */
router.get('/stream/:fileId', async (req, res) => {
  try {
    if (!isAuthenticated) {
      const initialized = await initDrive();
      if (!initialized) {
        return res.status(503).json({ 
          error: 'Google Drive not configured',
          message: 'Please setup Google Drive credentials first'
        });
      }
    }

    const { fileId } = req.params;
    
    console.log(chalk.cyan('📺 Streaming from Google Drive:'), fileId);

    // Get file metadata
    const fileMetadata = await drive.files.get({
      fileId: fileId,
      fields: 'size, mimeType, name, webContentLink',
    });

    const fileSize = parseInt(fileMetadata.data.size);
    const fileName = fileMetadata.data.name;
    const mimeType = fileMetadata.data.mimeType || 'video/x-matroska';

    console.log(chalk.blue('📄 File:'), fileName, `(${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

    const range = req.headers.range;

    if (range) {
      // Range request
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0]);
      const end = parts[1] ? parseInt(parts[1]) : fileSize - 1;
      const chunksize = (end - start) + 1;

      console.log(chalk.magenta('📦 Range:'), `${start}-${end}/${fileSize}`);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });

      // Stream with range
      const driveStream = await drive.files.get(
        {
          fileId: fileId,
          alt: 'media',
        },
        {
          responseType: 'stream',
          headers: {
            Range: `bytes=${start}-${end}`,
          },
        }
      );

      driveStream.data
        .on('end', () => {
          console.log(chalk.green('✅ Stream completed'));
        })
        .on('error', (err) => {
          console.error(chalk.red('❌ Stream error:'), err.message);
        })
        .pipe(res);

    } else {
      // Full file request
      console.log(chalk.yellow('⚡ Full file request'));

      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });

      const driveStream = await drive.files.get(
        {
          fileId: fileId,
          alt: 'media',
        },
        {
          responseType: 'stream',
        }
      );

      driveStream.data.pipe(res);
    }
  } catch (error) {
    console.error(chalk.red('❌ Google Drive error:'), error.message);
    res.status(500).json({ 
      error: 'Streaming failed',
      message: error.message 
    });
  }
});

/**
 * List files in a folder
 */
router.get('/list/:folderId?', async (req, res) => {
  try {
    if (!isAuthenticated) {
      await initDrive();
    }

    const { folderId } = req.params;
    const query = folderId 
      ? `'${folderId}' in parents and trashed=false`
      : "mimeType contains 'video' and trashed=false";

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, size, mimeType, webContentLink, thumbnailLink)',
      orderBy: 'name',
    });

    const files = response.data.files.map(file => ({
      id: file.id,
      name: file.name,
      size: parseInt(file.size || 0),
      sizeFormatted: file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'N/A',
      mimeType: file.mimeType,
      streamUrl: `/gdrive/stream/${file.id}`,
      thumbnail: file.thumbnailLink,
    }));

    res.json({
      success: true,
      count: files.length,
      files: files,
    });
  } catch (error) {
    console.error(chalk.red('❌ List error:'), error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get file info
 */
router.get('/info/:fileId', async (req, res) => {
  try {
    if (!isAuthenticated) {
      await initDrive();
    }

    const { fileId } = req.params;

    const file = await drive.files.get({
      fileId: fileId,
      fields: 'id, name, size, mimeType, webContentLink, thumbnailLink, createdTime, modifiedTime',
    });

    res.json({
      success: true,
      file: {
        id: file.data.id,
        name: file.data.name,
        size: parseInt(file.data.size || 0),
        sizeFormatted: `${(file.data.size / 1024 / 1024).toFixed(2)} MB`,
        mimeType: file.data.mimeType,
        streamUrl: `/gdrive/stream/${file.data.id}`,
        thumbnail: file.data.thumbnailLink,
        created: file.data.createdTime,
        modified: file.data.modifiedTime,
      },
    });
  } catch (error) {
    console.error(chalk.red('❌ Info error:'), error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Upload file to Google Drive (optional)
 */
router.post('/upload', async (req, res) => {
  try {
    if (!isAuthenticated) {
      await initDrive();
    }

    const { filePath, fileName, folderId } = req.body;

    const fileMetadata = {
      name: fileName,
      parents: folderId ? [folderId] : [],
    };

    const media = {
      mimeType: 'video/x-matroska',
      body: require('fs').createReadStream(filePath),
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, size, webContentLink',
    });

    console.log(chalk.green('✅ File uploaded:'), file.data.name);

    res.json({
      success: true,
      file: {
        id: file.data.id,
        name: file.data.name,
        size: file.data.size,
        streamUrl: `/gdrive/stream/${file.data.id}`,
      },
    });
  } catch (error) {
    console.error(chalk.red('❌ Upload error:'), error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * OAuth callback (for initial setup)
 */
router.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GDRIVE_CLIENT_ID,
      process.env.GDRIVE_CLIENT_SECRET,
      process.env.GDRIVE_REDIRECT_URI || 'http://localhost:64621/gdrive/auth/callback'
    );

    const { tokens } = await oauth2Client.getToken(code);
    
    console.log(chalk.green('✅ OAuth tokens received'));
    console.log(chalk.yellow('📝 Add this to your .env file:'));
    console.log(chalk.cyan(`GDRIVE_REFRESH_TOKEN=${tokens.refresh_token}`));

    res.send(`
      <h1>✅ Google Drive Authentication Successful!</h1>
      <p>Add this to your .env file:</p>
      <pre>GDRIVE_REFRESH_TOKEN=${tokens.refresh_token}</pre>
      <p>Then restart the server.</p>
    `);
  } catch (error) {
    console.error(chalk.red('❌ OAuth error:'), error.message);
    res.status(500).send('Authentication failed: ' + error.message);
  }
});

/**
 * Start OAuth flow
 */
router.get('/auth/start', (req, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GDRIVE_CLIENT_ID,
    process.env.GDRIVE_CLIENT_SECRET,
    process.env.GDRIVE_REDIRECT_URI || 'http://localhost:64621/gdrive/auth/callback'
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  console.log(chalk.cyan('🔐 OAuth URL:'), authUrl);
  res.redirect(authUrl);
});

// Initialize on module load
initDrive();

module.exports = router;
