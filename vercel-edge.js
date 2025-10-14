/**
 * 🚀 VERCEL EDGE FUNCTION - FREE CDN
 * ✅ 100 GB bandwidth/month (FREE)
 * ✅ Unlimited requests
 * ✅ Global edge network (70+ locations)
 * ✅ No daily limitstw
 !
 * 
 * Deploy: vercel --prod
 */

export const config = {
  runtime: 'edge',
};

// Cache duration: 1 hour
const CACHE_DURATION = 3600;

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const backendUrl = searchParams.get('url');
  
  if (!backendUrl) {
    return new Response('Missing "url" parameter', { 
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
  
  console.log('📡 Vercel Edge:', backendUrl);
  
  try {
    // Forward request to backend
    const response = await fetch(backendUrl, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers),
        'X-Forwarded-By': 'Vercel-Edge'
      },
      body: request.method !== 'GET' && request.method !== 'HEAD' 
        ? request.body 
        : undefined
    });
    
    // Clone for modifications
    const modifiedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
    
    // Add cache headers for video content
    if (backendUrl.includes('/streamfile/') || backendUrl.includes('/stream/')) {
      modifiedResponse.headers.set('Cache-Control', `public, max-age=${CACHE_DURATION}`);
      modifiedResponse.headers.set('CDN-Cache-Control', `public, max-age=${CACHE_DURATION}`);
      modifiedResponse.headers.set('Vercel-CDN-Cache-Control', `public, max-age=${CACHE_DURATION}`);
    }
    
    // Add CDN headers
    modifiedResponse.headers.set('X-CDN', 'Vercel-Edge');
    modifiedResponse.headers.set('X-Cache-Status', 'HIT');
    
    return modifiedResponse;
    
  } catch (error) {
    console.error('❌ Vercel Edge Error:', error);
    return new Response(`CDN Error: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}
