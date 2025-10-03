// Vercel Edge Function for CDN
export const config = {
  runtime: 'edge',
};

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
  
  try {
    const response = await fetch(backendUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined
    });
    
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', `public, max-age=${CACHE_DURATION}`);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('X-CDN', 'Vercel');
    
    return new Response(response.body, {
      status: response.status,
      headers
    });
  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}
