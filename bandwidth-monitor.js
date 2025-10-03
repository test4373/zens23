/**
 * 📊 BANDWIDTH MONITOR
 * Track and limit bandwidth usage to prevent network congestion
 */

import chalk from 'chalk';

class BandwidthMonitor {
  constructor(maxBandwidthMBps = 5) {
    this.maxBandwidth = maxBandwidthMBps * 1024 * 1024; // Convert to bytes
    this.currentBandwidth = 0;
    this.requests = [];
    this.startTime = Date.now();
    
    // Reset bandwidth counter every second
    setInterval(() => {
      this.currentBandwidth = 0;
    }, 1000);
    
    console.log(chalk.cyan('📊 Bandwidth Monitor initialized'));
    console.log(chalk.yellow('  Max bandwidth:'), maxBandwidthMBps, 'MB/s');
  }
  
  /**
   * Track a new request
   */
  trackRequest(req, res, next) {
    const requestStart = Date.now();
    let bytesTransferred = 0;
    
    // Intercept response
    const originalWrite = res.write;
    const originalEnd = res.end;
    
    res.write = function(chunk, ...args) {
      if (chunk) {
        bytesTransferred += chunk.length;
      }
      return originalWrite.call(this, chunk, ...args);
    };
    
    res.end = function(chunk, ...args) {
      if (chunk) {
        bytesTransferred += chunk.length;
      }
      
      const duration = Date.now() - requestStart;
      const speedKBps = (bytesTransferred / 1024 / (duration / 1000)).toFixed(2);
      
      console.log(chalk.gray('📤'), req.path, chalk.cyan(`${(bytesTransferred / 1024 / 1024).toFixed(2)} MB`), chalk.yellow(`${speedKBps} KB/s`));
      
      return originalEnd.call(this, chunk, ...args);
    };
    
    next();
  }
  
  /**
   * Check if we're within bandwidth limit
   */
  async checkBandwidth(bytes) {
    this.currentBandwidth += bytes;
    
    if (this.currentBandwidth > this.maxBandwidth) {
      // Bandwidth exceeded, wait a bit
      const delayMs = 100;
      console.log(chalk.yellow('⚠️  Bandwidth limit reached, throttling...'));
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  /**
   * Get current stats
   */
  getStats() {
    const uptime = Date.now() - this.startTime;
    const currentMBps = (this.currentBandwidth / 1024 / 1024).toFixed(2);
    const maxMBps = (this.maxBandwidth / 1024 / 1024).toFixed(2);
    
    return {
      uptime: Math.floor(uptime / 1000) + 's',
      currentBandwidth: currentMBps + ' MB/s',
      maxBandwidth: maxMBps + ' MB/s',
      usage: ((this.currentBandwidth / this.maxBandwidth) * 100).toFixed(1) + '%',
      status: this.currentBandwidth > this.maxBandwidth ? 'throttled' : 'normal'
    };
  }
  
  /**
   * Middleware function
   */
  middleware() {
    return (req, res, next) => this.trackRequest(req, res, next);
  }
}

/**
 * 🎯 Smart Quality Selector
 * Automatically adjust video quality based on network speed
 */
export class QualitySelector {
  constructor() {
    this.speedHistory = [];
    this.maxHistorySize = 10;
  }
  
  /**
   * Record network speed
   */
  recordSpeed(bytesPerSecond) {
    this.speedHistory.push(bytesPerSecond);
    if (this.speedHistory.length > this.maxHistorySize) {
      this.speedHistory.shift();
    }
  }
  
  /**
   * Get average speed
   */
  getAverageSpeed() {
    if (this.speedHistory.length === 0) return 0;
    
    const sum = this.speedHistory.reduce((a, b) => a + b, 0);
    return sum / this.speedHistory.length;
  }
  
  /**
   * Recommend quality based on speed
   */
  recommendQuality() {
    const avgSpeed = this.getAverageSpeed();
    const mbps = (avgSpeed * 8 / 1024 / 1024).toFixed(2);
    
    let quality = 'auto';
    let bufferSize = 30; // seconds
    
    if (mbps < 2) {
      quality = '480p';
      bufferSize = 20;
    } else if (mbps < 5) {
      quality = '720p';
      bufferSize = 30;
    } else if (mbps < 10) {
      quality = '1080p';
      bufferSize = 60;
    } else {
      quality = '4K';
      bufferSize = 120;
    }
    
    return {
      quality,
      bufferSize,
      bandwidth: mbps + ' Mbps',
      recommendation: `Use ${quality} with ${bufferSize}s buffer`
    };
  }
}

/**
 * 🔧 Export instances
 */
export const bandwidthMonitor = new BandwidthMonitor(5); // 5 MB/s limit
export const qualitySelector = new QualitySelector();

export default BandwidthMonitor;
