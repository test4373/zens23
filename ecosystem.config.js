// PM2 Ecosystem Configuration
export default {
  apps: [{
    name: 'zenshin-backend',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    
    // Auto-restart on crash
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    
    // Environment
    env: {
      NODE_ENV: 'development',
      PORT: 64621
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 64621
    },
    
    // Logging
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Restart策略
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    
    // Kill timeout
    kill_timeout: 5000,
    listen_timeout: 10000,
    
    // Cron restart (her gün saat 04:00'te yeniden başlat - memory leak önleme)
    cron_restart: '0 4 * * *',
    
    // Watch for file changes (disable in production)
    ignore_watch: ['node_modules', 'logs', 'downloads', 'temp_subs'],
  }]
};
