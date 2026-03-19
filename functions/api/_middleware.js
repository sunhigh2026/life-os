export async function onRequest(context) {
  const { request, env, next } = context;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // OPTIONSリクエスト（preflight）
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // OAuthコールバックは認証スキップ（Googleからのリダイレクト）
  const url = new URL(request.url);
  const isOAuthCallback = url.pathname === '/api/calendar' && url.searchParams.get('action') === 'callback';

  if (!isOAuthCallback) {
    // AUTH_KEY検証
    const authHeader = request.headers.get('Authorization');
    const expectedKey = `Bearer ${env.AUTH_KEY}`;
    if (!authHeader || authHeader !== expectedKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  const response = await next();

  // レスポンスにCORSヘッダーを付与
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers: newHeaders,
  });
}
