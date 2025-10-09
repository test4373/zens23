// PM2 Ecosystem Configuration for Windows VPS
// Kullanim: pm2 start pm2-ecosystem.config.js

module.exports = {
  apps: [{
    name: 'zenshin-backend',
    script: './server.js',
    
    // Instances
    instances: 1,
    exec_mode: 'fork', // Windows'ta 'cluster' yerine 'fork' kullan
    
    // Environment
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    
    // Logging
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Auto restart
    watch: false, // Production'da false
    ignore_watch: [
      'node_modules',
      'downloads',
      'temp_subs',
      'hls_cache',
      'logs',
      '*.db'
    ],
    
    // Restart policy
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '1G',
    
    // Restart delay
    restart_delay: 4000,
    
    // Auto restart on crash
    autorestart: true,
    
    // Kill timeout
    kill_timeout: 5000,
    
    // Listen timeout
    listen_timeout: 10000,
    
    // Windows specific
    windowsHide: true, // Console penceresini gizle
    
    // Advanced
    time: true,
    
    // Cron restart (her gece 3'te yeniden baslat - opsiyonel)
    // cron_restart: '0 3 * * *',
    
    // Interpreter
    interpreter: 'node',
    
    // Args
    args: '',
    
    // Node args
    node_args: '--max-old-space-size=2048', // 2GB RAM limiti
  }]
};
