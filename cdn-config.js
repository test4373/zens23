/**
 * 🌐 FREE CDN CONFIGURATION
 * Ücretsiz CDN servisleri ile bandwidth'i azaltmak için
 */

export const CDN_CONFIG = {
  // ⚠️ Cloudflare Workers (100k requests/DAY - günlük limit var)
  cloudflare: {
    enabled: false,
    workerUrl: 'https://your-worker.workers.dev',
    limits: '100k requests/day',
    bandwidth: '10 GB/day',
    description: 'Günlük limit - önerilmez'
  },
  
  // ✅ Netlify Edge (BEST - 100 GB/MONTH, sınırsız istek)
  netlify: {
    enabled: false,  // Backend Render.com'da
    edgeUrl: 'https://your-site.netlify.app/api',
    limits: 'Unlimited requests',
    bandwidth: '100 GB/month',
    description: '✅ ÖNERİLEN - Aylık limit + sınırsız istek'
  },
  
  // ✅ Vercel Edge (BEST - 100 GB/MONTH, sınırsız istek)
  vercel: {
    enabled: true,  // ✅ AKTİF!
    edgeUrl: 'https://zenshin-6vkue2gkl-deneme2143y-7273s-projects.vercel.app/api',
    limits: 'Unlimited requests',
    bandwidth: '100 GB/month',
    description: '✅ ÖNERİLEN - Aylık limit + sınırsız istek'
  },
  
  // ❌ BunnyCDN (Ücretli)
  bunnycdn: {
    enabled: false,
    pullZoneUrl: 'https://your-pull-zone.b-cdn.net',
    description: 'Ücretli servis'
  }
};

/**
 * 🎯 BANDWIDTH OPTIMIZATION STRATEGIES
 */
export const OPTIMIZATION_STRATEGIES = {
  // Strategy 1: Adaptive bitrate (low/medium/high)
  adaptiveBitrate: {
    enabled: true,
    profiles: {
      'very-low': {
        maxBandwidth: 1 * 1024 * 1024,    // 1 Mbps (480p için)
        chunkSize: 512 * 1024,            // 512 KB chunks
        bufferAhead: 20,                  // 20 saniye
        quality: '480p',
        description: 'Çok yavaş internet (1 Mbps)'
      },
      low: {
        maxBandwidth: 2 * 1024 * 1024,    // 2 Mbps (720p için)
        chunkSize: 1 * 1024 * 1024,       // 1 MB chunks
        bufferAhead: 30,                  // 30 saniye
        quality: '720p',
        description: 'Yavaş internet (2-3 Mbps)'
      },
      medium: {
        maxBandwidth: 5 * 1024 * 1024,    // 5 Mbps (1080p için)
        chunkSize: 2 * 1024 * 1024,       // 2 MB chunks
        bufferAhead: 60,                  // 1 dakika
        quality: '1080p',
        description: 'Normal internet (5 Mbps)'
      },
      high: {
        maxBandwidth: 10 * 1024 * 1024,   // 10 Mbps (4K için)
        chunkSize: 4 * 1024 * 1024,       // 4 MB chunks
        bufferAhead: 120,                 // 2 dakika
        quality: '4K',
        description: 'Hızlı internet (10+ Mbps)'
      }
    }
  },
  
  // Strategy 2: Smart caching
  smartCaching: {
    enabled: true,
    cachePopularContent: true,
    cacheFirstMinutes: 5,  // Cache first 5 minutes of every video
    cacheDuration: 3600    // 1 hour cache
  },
  
  // Strategy 3: Peer-to-Peer sharing (WebRTC)
  p2pSharing: {
    enabled: true,
    maxPeers: 5,           // Share with max 5 peers
    uploadLimit: 64 * 1024 // 64 KB/s upload per peer
  },
  
  // Strategy 4: Progressive loading
  progressiveLoading: {
    enabled: true,
    initialLoad: 5 * 1024 * 1024,  // Load first 5 MB immediately
    thenLoadPerRequest: 2 * 1024 * 1024  // Then 2 MB per request
  }
};

/**
 * 🔧 Get optimal strategy based on network speed
 */
export function getOptimalStrategy(downloadSpeedKBps) {
  const speedMbps = (downloadSpeedKBps * 8) / 1024;
  
  if (speedMbps < 1.5) {
    return 'very-low';  // 480p
  } else if (speedMbps < 3) {
    return 'low';       // 720p
  } else if (speedMbps < 7) {
    return 'medium';    // 1080p
  } else {
    return 'high';      // 4K
  }
}

/**
 * 🎯 Get CDN URL based on configuration
 */
export function getCDNUrl(backendUrl) {
  // Use Netlify if enabled (recommended)
  if (CDN_CONFIG.netlify.enabled && CDN_CONFIG.netlify.edgeUrl !== 'https://your-site.netlify.app/api') {
    return `${CDN_CONFIG.netlify.edgeUrl}/cdn?url=${encodeURIComponent(backendUrl)}`;
  }
  
  // Use Vercel if enabled
  if (CDN_CONFIG.vercel.enabled && CDN_CONFIG.vercel.edgeUrl !== 'https://your-app.vercel.app/api') {
    return `${CDN_CONFIG.vercel.edgeUrl}/cdn?url=${encodeURIComponent(backendUrl)}`;
  }
  
  // Fallback to direct connection (no CDN)
  console.warn('⚠️ No CDN configured, using direct connection');
  return backendUrl;
}

/**
 * 🌍 FREE CDN Providers List (Sorted by recommendation)
 */
export const FREE_CDN_PROVIDERS = [
  {
    rank: '🥇',
    name: 'Netlify Edge',
    free: 'Unlimited requests',
    bandwidth: '100 GB/month',
    edge: 'Global (30+ locations)',
    setup: 'Easy (5 min)',
    dailyLimit: 'NO ✅',
    recommendation: '⭐ BEST CHOICE',
    url: 'https://netlify.com'
  },
  {
    rank: '🥈',
    name: 'Vercel Edge',
    free: 'Unlimited requests',
    bandwidth: '100 GB/month',
    edge: 'Global (70+ locations)',
    setup: 'Easy (GitHub deploy)',
    dailyLimit: 'NO ✅',
    recommendation: '⭐ BEST CHOICE',
    url: 'https://vercel.com'
  },
  {
    rank: '🥉',
    name: 'Deno Deploy',
    free: '100k requests/day ⚠️',
    bandwidth: '100 GB/month',
    edge: 'Global (35+ regions)',
    setup: 'Medium',
    dailyLimit: 'YES ⚠️',
    recommendation: 'Good alternative',
    url: 'https://deno.com/deploy'
  },
  {
    rank: '⚠️',
    name: 'Cloudflare Workers',
    free: '100k requests/day ⚠️',
    bandwidth: '10 GB/day',
    edge: 'Global (200+ locations)',
    setup: 'Easy',
    dailyLimit: 'YES ⚠️',
    recommendation: 'Not recommended (daily limit)',
    url: 'https://workers.cloudflare.com'
  },
  {
    rank: '❌',
    name: 'Fastly',
    free: '$50 credit',
    bandwidth: 'Pay as you go',
    edge: 'Global (70+ PoPs)',
    setup: 'Hard',
    dailyLimit: 'N/A',
    recommendation: 'Not free',
    url: 'https://fastly.com'
  }
];

/**
 * 📊 Monthly Bandwidth Calculator
 */
export function calculateMonthlyUsage(episodesPerDay, avgSizeMB) {
  const dailyUsage = episodesPerDay * avgSizeMB;
  const monthlyUsage = dailyUsage * 30;
  
  const netlifyLimit = 100 * 1024; // 100 GB
  const vercelLimit = 100 * 1024;  // 100 GB
  
  return {
    dailyUsage: dailyUsage.toFixed(2) + ' MB',
    monthlyUsage: monthlyUsage.toFixed(2) + ' MB',
    netlifyRemaining: (netlifyLimit - monthlyUsage).toFixed(2) + ' MB',
    vercelRemaining: (vercelLimit - monthlyUsage).toFixed(2) + ' MB',
    withinLimit: monthlyUsage < netlifyLimit,
    recommendation: monthlyUsage < netlifyLimit 
      ? '✅ Netlify/Vercel ideal'
      : '⚠️ Çok fazla kullanım, bandwidth limit gerekli'
  };
}

export default CDN_CONFIG;
