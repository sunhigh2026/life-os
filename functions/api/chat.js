function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const DEFAULT_SYSTEM_PROMPT = `あなたは「ピアちゃん」というキャラクターです。
見た目はもちもちしたピンクのゆるキャラ。
性格はのんびりしているけど、実はよく見ている。
口調は「〜だよ」「〜だね」「〜かも！」。
褒めるときは「すごいじゃん！」「がんばったね〜！」としっかり褒める。
気になる点は「ちょっと気になったんだけど〜」とやさしく切り出す。
絶対に説教しない。短めに話す。絵文字を適度に使う。
ユーザーの日記・ToDo・読書データにアクセスできる。
データに基づいた具体的なアドバイスをする。
回答は簡潔に、200文字以内を目安にしてください。`;

// POST /api/chat
export async function onRequestPost({ request, env }) {
  const { message } = await request.json();
  if (!message) return json({ error: 'message required' }, 400);

  if (!env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY not configured' }, 500);
  }

  const today = new Date().toISOString().slice(0, 10);

  // コンテキスト + キャラ設定を並行取得
  const [
    { results: recentEntries },
    { results: openTodos },
    { results: recentBooks },
    { results: settingsRows },
    { results: fitnessData },
    { results: activeGoals },
    { results: menstrualDates },
  ] = await Promise.all([
    env.DB.prepare(`SELECT datetime, mood, tag, text FROM entries ORDER BY datetime DESC LIMIT 10`).all(),
    env.DB.prepare(`SELECT text, tag, priority, due FROM todos WHERE status = 'open' ORDER BY created_at DESC LIMIT 10`).all(),
    env.DB.prepare(`SELECT title, author, rating, status, note FROM books ORDER BY datetime DESC LIMIT 5`).all(),
    env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('char_system_prompt', 'char_name', 'gcal_access_token', 'gcal_refresh_token', 'gcal_token_expires')`).all(),
    env.DB.prepare(`SELECT date, steps, active_minutes, weight FROM fitness ORDER BY date DESC LIMIT 7`).all(),
    env.DB.prepare(`SELECT goal, target, unit, freq, status FROM goals WHERE status = 'active' LIMIT 5`).all(),
    env.DB.prepare(`SELECT DISTINCT substr(datetime, 1, 10) as date FROM entries WHERE text LIKE '%生理%' ORDER BY date DESC LIMIT 5`).all(),
  ]);

  // settings をマップ化
  const settings = {};
  settingsRows.forEach(r => { settings[r.key] = r.value; });

  const systemPrompt = settings['char_system_prompt'] || DEFAULT_SYSTEM_PROMPT;

  // カレンダー予定を取得（連携済みの場合のみ）
  let calendarText = '';
  if (settings.gcal_refresh_token && settings.gcal_access_token) {
    try {
      let accessToken = settings.gcal_access_token;
      if (settings.gcal_token_expires && Date.now() >= Number(settings.gcal_token_expires)) {
        // トークンリフレッシュ
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            refresh_token: settings.gcal_refresh_token,
            grant_type: 'refresh_token',
          }),
        });
        if (tokenRes.ok) {
          const td = await tokenRes.json();
          accessToken = td.access_token;
        }
      }
      const now = new Date();
      const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const ymd = jst.toISOString().slice(0, 10);
      const timeMin = new Date(ymd + 'T00:00:00+09:00');
      const timeMax = new Date(ymd + 'T00:00:00+09:00');
      timeMax.setDate(timeMax.getDate() + 2); // 今日+明日

      const params = new URLSearchParams({
        timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '20', timeZone: 'Asia/Tokyo',
      });
      const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (calRes.ok) {
        const calData = await calRes.json();
        const events = (calData.items || []).map(ev => {
          const start = ev.start?.dateTime?.slice(11, 16) || '終日';
          return `- ${ev.start?.dateTime?.slice(0, 10) || ev.start?.date} ${start} ${ev.summary || '(無題)'}`;
        });
        if (events.length) calendarText = `\n\n今日〜明日のカレンダー予定:\n${events.join('\n')}`;
      }
    } catch (_) { /* カレンダー取得失敗は無視 */ }
  }

  const contextText = `
今日の日付: ${today}

最近の日記（最新10件）:
${recentEntries.map((e) => `- ${e.datetime} [mood:${e.mood}] [tag:${e.tag}] ${e.text}`).join('\n') || 'なし'}

未完了ToDo:
${openTodos.map((t) => `- [${t.priority}] ${t.text} (期限:${t.due || 'なし'}) [tag:${t.tag}]`).join('\n') || 'なし'}

最近の読書:
${recentBooks.map((b) => `- ${b.title}（${b.author}）★${b.rating} [${b.status}] ${b.note || ''}`).join('\n') || 'なし'}

直近のフィットネス:
${fitnessData.length ? fitnessData.map(f => `- ${f.date} 歩数:${f.steps || '-'} 運動:${f.active_minutes || '-'}分 体重:${f.weight || '-'}kg`).join('\n') : 'データなし'}

目標:
${activeGoals.length ? activeGoals.map(g => `- ${g.goal}（目標:${g.target}${g.unit}/${g.freq}）`).join('\n') : '未設定'}

生理記録日（直近5回の開始日付近）:
${menstrualDates.length ? menstrualDates.map(d => d.date).join(', ') : '記録なし'}${calendarText}
`.trim();

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: `${systemPrompt}\n\n【コンテキスト】\n${contextText}\n\n【ユーザーのメッセージ】\n${message}` }] },
          ],
          generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      const errMsg = data.error?.message || JSON.stringify(data).slice(0, 200);
      return json({ error: 'Gemini API error', detail: errMsg }, 502);
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'うまく答えられなかったよ…ごめんね！';

    return json({ reply, charName: settings['char_name'] || null });
  } catch (e) {
    return json({ error: 'Gemini API error', detail: e.message }, 502);
  }
}
