/**
 * 🚀 NETLIFY EDGE FUNCTION - FREE CDN
 * ✅ 100 GB bandwidth/month (FREE)
 * ✅ Unlimited edge requests
 * ✅ Global CDN (30+ locations)
 * ✅ No daily limits!
 * 
 * Path: /.netlify/edge-functions/cdn
 */

const CACHE_DURATION = 3600; // 1 hour

export default async (request, context) => {
  const url = new URL(request.url);
  const backendUrl = url.searchParams.get('url');
  
  if (!backendUrl) {
    return new Response('Missing "url" parameter', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
  
  console.log('📡 Netlify Edge:', backendUrl);
  
  try {
    // Check Netlify edge cache first
    const cacheKey = `edge-cache-${backendUrl}`;
    const cachedResponse = await context.cookies.get(cacheKey);
    
    if (cachedResponse) {
      console.log('✅ Cache HIT');
      return new Response(cachedResponse, {
        headers: {
          'X-Cache': 'HIT',
          'X-CDN': 'Netlify-Edge'
        }
      });
    }
    
    console.log('❌ Cache MISS, fetching...');
    
    // Forward to backend
    const response = await fetch(backendUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' 
        ? request.body 
        : undefined
    });
    
    if (!response.ok) {
      return response;
    }
    
    // Clone response
    const responseClone = response.clone();
    const headers = new Headers(response.headers);
    
    // Add cache headers
    headers.set('Cache-Control', `public, max-age=${CACHE_DURATION}`);
    headers.set('Netlify-CDN-Cache-Control', `public, max-age=${CACHE_DURATION}, stale-while-revalidate=86400`);
    headers.set('X-CDN', 'Netlify-Edge');
    headers.set('X-Cache', 'MISS');
    headers.set('Access-Control-Allow-Origin', '*');
    
    // Store in edge cache (non-blocking)
    context.cookies.set({
      name: cacheKey,
      value: await responseClone.text(),
      maxAge: CACHE_DURATION,
      path: '/'
    });
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
    
  } catch (error) {
    console.error('❌ Netlify Edge Error:', error);
    return new Response(`CDN Error: ${error.message}`, {
      status: 500,
      headers: { 
        'Content-Type': 'text/plain',
        'X-CDN': 'Netlify-Edge',
        'X-Error': error.message
      }
    });
  }
};

export const config = {
  path: '/api/cdn',
  cache: 'manual'
};
