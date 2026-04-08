export async function onRequest(context) {
  const { request, env, next } = context;

  // OPTIONSリクエスト（preflight）
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const url = new URL(request.url);

  // ログインエンドポイントとOAuthコールバックは認証スキップ
  const isLoginEndpoint = url.pathname === '/api/login';
  const isOAuthCallback =
    url.pathname === '/api/calendar' && url.searchParams.get('action') === 'callback';

  if (!isLoginEndpoint && !isOAuthCallback) {
    // Authorization ヘッダー（GAS等サーバー間通信）
    const authHeader = request.headers.get('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    // セッションCookie（ブラウザ）
    const cookieHeader = request.headers.get('Cookie') || '';
    const sessionMatch = cookieHeader.match(/(?:^|;\s*)life_os_session=([^;]+)/);
    const sessionToken = sessionMatch ? sessionMatch[1] : null;

    const isAuthed = (bearerToken && bearerToken === env.AUTH_KEY)
                  || (sessionToken && sessionToken === env.AUTH_KEY);

    if (!isAuthed) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return next();
}
