import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * 🔥 ZERO-DISK HLS Engine
 * - Direct transmux (copy mode - no re-encode)
 * - Auto-cleanup segments
 * - Minimal disk usage
 * - All audio/subtitle tracks included
 */

export class ZeroDiskHLS {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.activeStreams = new Map(); // Track active conversions
  }

  /**
   * Generate HLS stream for video file
   * @param {string} videoPath - Path to MKV file
   * @param {string} videoId - Unique ID for this video
   * @returns {Promise<string>} - Path to master playlist
   */
  async createStream(videoPath, videoId) {
    const streamDir = path.join(this.cacheDir, videoId);
    const masterPlaylist = path.join(streamDir, 'master.m3u8');
    const streamPlaylist = path.join(streamDir, 'stream.m3u8');

    // Check if already exists and is recent (< 10 min)
    if (fs.existsSync(masterPlaylist)) {
      const stats = fs.statSync(masterPlaylist);
      const age = Date.now() - stats.mtimeMs;
      
      if (age < 10 * 60 * 1000) {
        console.log(chalk.green('✅ Using cached HLS stream'));
        return masterPlaylist;
      } else {
        // Expired - clean up
        fs.rmSync(streamDir, { recursive: true, force: true });
      }
    }

    // Create stream directory
    if (!fs.existsSync(streamDir)) {
      fs.mkdirSync(streamDir, { recursive: true });
    }

    console.log(chalk.cyan('🔄 Creating HLS stream (transmux mode)...'));

    // 🔥 TRANSMUX: Copy all streams, no re-encoding!
    return new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-c', 'copy',                           // Copy all codecs
        '-map', '0',                            // Include ALL streams
        '-f', 'hls',
        '-hls_time', '4',                       // 4-second segments
        '-hls_list_size', '10',                 // Rolling window (10 segments = 40s)
        '-hls_flags', 'delete_segments',        // Auto-delete old segments
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', path.join(streamDir, 'seg%03d.ts'),
        streamPlaylist
      ];

      const proc = spawn(ffmpegPath.path, args);

      proc.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('time=')) {
          const match = output.match(/time=(\d+):(\d+):(\d+)/);
          if (match) {
            const [, h, m, s] = match;
            console.log(chalk.gray('  ⏱️'), `${h}:${m}:${s}`);
          }
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Create simple master playlist
          const masterContent = [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            'stream.m3u8'
          ].join('\n');

          fs.writeFileSync(masterPlaylist, masterContent);
          console.log(chalk.green('✅ HLS stream ready'));

          // Schedule cleanup after 15 minutes
          setTimeout(() => {
            if (fs.existsSync(streamDir)) {
              fs.rmSync(streamDir, { recursive: true, force: true });
              console.log(chalk.gray('🧹 Cleaned HLS cache:'), videoId);
            }
          }, 15 * 60 * 1000);

          resolve(masterPlaylist);
        } else {
          reject(new Error(`FFmpeg failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Get current cache size
   */
  getCacheSize() {
    let total = 0;
    
    try {
      const walk = (dir) => {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          const filePath = path.join(dir, file.name);
          if (file.isDirectory()) {
            walk(filePath);
          } else {
            total += fs.statSync(filePath).size;
          }
        }
      };
      
      if (fs.existsSync(this.cacheDir)) {
        walk(this.cacheDir);
      }
    } catch (err) {
      console.error('Error calculating cache size:', err);
    }
    
    return total;
  }

  /**
   * Clean all cache
   */
  clearCache() {
    if (fs.existsSync(this.cacheDir)) {
      fs.rmSync(this.cacheDir, { recursive: true, force: true });
      fs.mkdirSync(this.cacheDir, { recursive: true });
      console.log(chalk.green('✅ HLS cache cleared'));
    }
  }
}

export default ZeroDiskHLS;
