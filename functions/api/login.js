// POST /api/login
// 認証キーを検証してHttpOnly Cookieを発行する
export async function onRequestPost({ request, env }) {
  let key;
  try {
    ({ key } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: '不正なリクエスト' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!key || key !== env.AUTH_KEY) {
    return new Response(JSON.stringify({ error: '認証キーが正しくありません' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 30日間有効なHttpOnly Cookieを発行
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `life_os_session=${env.AUTH_KEY}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`,
    },
  });
}
