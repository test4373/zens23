/**
 * 🌐 CLOUDFLARE WORKER - FREE CDN
 * 100k requests/day + 10 GB bandwidth (FREE tier)
 * 
 * DEPLOY: wrangler deploy
 * URL: https://your-worker.workers.dev
 */

// ✅ Cache everything for 1 hour
const CACHE_DURATION = 3600; // 1 hour

/**
 * Main request handler
 */
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

/**
 * Handle incoming requests
 */
async function handleRequest(request) {
  const url = new URL(request.url);
  
  // Extract backend URL from query param
  // Example: https://worker.dev/proxy?url=http://localhost:64621/streamfile/...
  const backendUrl = url.searchParams.get('url');
  
  if (!backendUrl) {
    return new Response('Missing "url" parameter', { status: 400 });
  }
  
  // Create cache key
  const cacheKey = new Request(backendUrl, {
    method: 'GET',
    headers: request.headers
  });
  
  // Check cache first
  const cache = caches.default;
  let response = await cache.match(cacheKey);
  
  if (response) {
    console.log('✅ Cache HIT:', backendUrl);
    return response;
  }
  
  console.log('❌ Cache MISS:', backendUrl);
  
  // Forward request to backend
  try {
    response = await fetch(backendUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body
    });
    
    // Clone response for caching
    const responseToCache = response.clone();
    
    // Only cache successful responses
    if (response.ok) {
      // Add cache headers
      const headers = new Headers(responseToCache.headers);
      headers.set('Cache-Control', `public, max-age=${CACHE_DURATION}`);
      headers.set('X-CDN-Cache', 'MISS');
      
      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers
      });
      
      // Store in cache (non-blocking)
      event.waitUntil(cache.put(cacheKey, cachedResponse));
    }
    
    return response;
  } catch (error) {
    return new Response(`CDN Error: ${error.message}`, { status: 500 });
  }
}

/**
 * ⚡ Advanced: Smart bandwidth optimization
 */
async function handleSmartRequest(request) {
  const url = new URL(request.url);
  const range = request.headers.get('Range');
  
  // If range request, only fetch what's needed
  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1]);
      const end = match[2] ? parseInt(match[2]) : start + (2 * 1024 * 1024); // 2MB chunks
      
      console.log(`📊 Range request: ${start}-${end}`);
      
      // Fetch only this range
      const backendUrl = url.searchParams.get('url');
      const rangeResponse = await fetch(backendUrl, {
        headers: {
          'Range': `bytes=${start}-${end}`
        }
      });
      
      return rangeResponse;
    }
  }
  
  // Fallback to normal request
  return handleRequest(request);
}
