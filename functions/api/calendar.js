function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ==============================
// OAuth ヘルパー
// ==============================
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';

function getRedirectUri(request) {
  const url = new URL(request.url);
  return `${url.origin}/api/calendar?action=callback`;
}

async function getTokens(env) {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN ('gcal_access_token', 'gcal_refresh_token', 'gcal_token_expires')`
  ).all();
  const map = {};
  results.forEach(r => { map[r.key] = r.value; });
  return map;
}

async function saveTokens(env, accessToken, refreshToken, expiresIn) {
  const expiresAt = Date.now() + (expiresIn - 60) * 1000; // 60秒早めに期限切れ扱い
  const stmts = [
    env.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).bind('gcal_access_token', accessToken),
    env.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).bind('gcal_token_expires', String(expiresAt)),
  ];
  if (refreshToken) {
    stmts.push(
      env.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).bind('gcal_refresh_token', refreshToken)
    );
  }
  await env.DB.batch(stmts);
}

async function refreshAccessToken(env) {
  const tokens = await getTokens(env);
  if (!tokens.gcal_refresh_token) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.gcal_refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  await saveTokens(env, data.access_token, null, data.expires_in);
  return data.access_token;
}

async function getValidAccessToken(env) {
  const tokens = await getTokens(env);
  if (!tokens.gcal_access_token || !tokens.gcal_refresh_token) return null;

  // トークンが有効期限内ならそのまま使う
  if (tokens.gcal_token_expires && Date.now() < Number(tokens.gcal_token_expires)) {
    return tokens.gcal_access_token;
  }

  // 期限切れなのでリフレッシュ
  return await refreshAccessToken(env);
}

// ==============================
// Calendar API ヘルパー
// ==============================
async function fetchEvents(accessToken, timeMin, timeMax) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
    timeZone: 'Asia/Tokyo',
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Calendar API ${res.status}`);
  }

  const data = await res.json();
  return (data.items || []).map(ev => ({
    id: ev.id,
    summary: ev.summary || '(タイトルなし)',
    start: ev.start?.dateTime || ev.start?.date || '',
    end: ev.end?.dateTime || ev.end?.date || '',
    allDay: !!ev.start?.date,
    location: ev.location || '',
  }));
}

// 日本時間の日付から開始・終了を計算
function jstDayRange(offsetDays = 0, rangeDays = 1) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const ymd = jst.toISOString().slice(0, 10);
  const base = new Date(ymd + 'T00:00:00+09:00');
  base.setDate(base.getDate() + offsetDays);
  const end = new Date(base);
  end.setDate(end.getDate() + rangeDays);
  return { timeMin: base, timeMax: end };
}

// ==============================
// GET /api/calendar?action=...
// ==============================
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // --- 認証URL生成 ---
  if (action === 'auth') {
    if (!env.GOOGLE_CLIENT_ID) {
      return json({ error: 'GOOGLE_CLIENT_ID not configured' }, 500);
    }
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: getRedirectUri(request),
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }

  // --- OAuthコールバック ---
  if (action === 'callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      return new Response(`<html><body><h2>認証エラー</h2><p>${error}</p><p><a href="/">ホームに戻る</a></p></body></html>`, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (!code) return json({ error: 'code required' }, 400);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: getRedirectUri(request),
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return new Response(`<html><body><h2>トークン取得エラー</h2><pre>${JSON.stringify(tokenData, null, 2)}</pre><p><a href="/">ホームに戻る</a></p></body></html>`, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    await saveTokens(env, tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);

    // 成功 → ホームにリダイレクト
    return new Response(`<html><head><meta http-equiv="refresh" content="1;url=/"></head><body><h2>✅ カレンダー連携完了！</h2><p>ホームに戻ります...</p></body></html>`, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // --- 連携状態チェック ---
  if (action === 'status') {
    const tokens = await getTokens(env);
    const connected = !!tokens.gcal_refresh_token;
    return json({ connected });
  }

  // --- 今日の予定 ---
  if (action === 'today') {
    const accessToken = await getValidAccessToken(env);
    if (!accessToken) return json({ events: [], connected: false });
    try {
      const { timeMin, timeMax } = jstDayRange(0);
      const events = await fetchEvents(accessToken, timeMin, timeMax);
      return json({ events, connected: true });
    } catch (e) {
      return json({ events: [], error: e.message, connected: true }, 200);
    }
  }

  // --- 明日の予定 ---
  if (action === 'tomorrow') {
    const accessToken = await getValidAccessToken(env);
    if (!accessToken) return json({ events: [], connected: false });
    try {
      const { timeMin, timeMax } = jstDayRange(1);
      const events = await fetchEvents(accessToken, timeMin, timeMax);
      return json({ events, connected: true });
    } catch (e) {
      return json({ events: [], error: e.message, connected: true }, 200);
    }
  }

  // --- 今週の予定 ---
  if (action === 'week') {
    const accessToken = await getValidAccessToken(env);
    if (!accessToken) return json({ events: [], connected: false });
    try {
      const { timeMin, timeMax } = jstDayRange(0, 7);
      const events = await fetchEvents(accessToken, timeMin, timeMax);
      return json({ events, connected: true });
    } catch (e) {
      return json({ events: [], error: e.message, connected: true }, 200);
    }
  }

  return json({ error: 'action required: auth|callback|status|today|tomorrow|week' }, 400);
}
