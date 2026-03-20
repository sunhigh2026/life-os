function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/todo-suggest — AIが今日やるべきタスクを提案
export async function onRequestGet({ env }) {
  const today = new Date().toISOString().slice(0, 10);

  // 未完了ToDo取得
  const { results: todos } = await env.DB.prepare(
    `SELECT id, text, tag, priority, due, created_at FROM todos WHERE status = 'open' ORDER BY created_at DESC`
  ).all();

  if (!todos.length) {
    return json({ suggestions: [], message: 'タスクがないよ！のんびりしよ〜🌸' });
  }

  // カレンダー予定を取得（連携済みの場合）
  let calendarInfo = '';
  try {
    const { results: settingsRows } = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN ('gcal_access_token', 'gcal_refresh_token', 'gcal_token_expires')`
    ).all();
    const settings = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    if (settings.gcal_refresh_token && settings.gcal_access_token) {
      let accessToken = settings.gcal_access_token;
      if (settings.gcal_token_expires && Date.now() >= Number(settings.gcal_token_expires)) {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
            refresh_token: settings.gcal_refresh_token, grant_type: 'refresh_token',
          }),
        });
        if (tokenRes.ok) {
          const td = await tokenRes.json();
          accessToken = td.access_token;
        }
      }

      const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const ymd = jst.toISOString().slice(0, 10);
      const timeMin = new Date(ymd + 'T00:00:00+09:00');
      const timeMax = new Date(ymd + 'T00:00:00+09:00');
      timeMax.setDate(timeMax.getDate() + 1);

      const params = new URLSearchParams({
        timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '10', timeZone: 'Asia/Tokyo',
      });
      const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (calRes.ok) {
        const calData = await calRes.json();
        const events = (calData.items || []).map(ev => {
          const start = ev.start?.dateTime?.slice(11, 16) || '終日';
          return `${start} ${ev.summary || '(無題)'}`;
        });
        if (events.length) calendarInfo = `\n\n今日のカレンダー予定:\n${events.join('\n')}`;
      }
    }
  } catch (_) {}

  // Gemini に提案を依頼
  const todoList = todos.map(t =>
    `[${t.id}] 優先度:${t.priority} 分類:${t.category || '未分類'} 期限:${t.due || 'なし'} タグ:${t.tag || 'なし'} 「${t.text}」`
  ).join('\n');

  const prompt = `あなたはタスク整理アシスタント「ピアちゃん」です。
今日は${today}。以下の未完了ToDoリストとカレンダー予定を見て、今日やるべきタスクを3〜5件選んでください。

選択基準:
- 分類が「must」（やらなきゃ）のものを最優先
- 期限が今日または超過しているもの優先
- 優先度highを優先
- カレンダーの予定と関連があるもの
- 長く放置されているもの
- 「want」（やりたい）は余裕があれば1件入れる

未完了ToDo:
${todoList}${calendarInfo}

以下のJSON形式で返答してください（他の文章は不要）:
{"ids":["選んだtodoのid1","id2","id3"],"comment":"ピアちゃん口調で今日のアドバイスを一言（40字以内）"}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
        }),
      }
    );

    if (!res.ok) {
      return json({ suggestions: todos.slice(0, 3).map(t => t.id), message: '今日も一歩ずつがんばろ〜！🐾' });
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // JSON部分を抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return json({
        suggestions: parsed.ids || [],
        message: parsed.comment || '今日もがんばろ〜！🐾',
      });
    }
  } catch (_) {}

  // フォールバック: 期限順 + 優先度順で上位3件
  const fallback = todos
    .sort((a, b) => {
      if (a.due && !b.due) return -1;
      if (!a.due && b.due) return 1;
      if (a.due && b.due) return a.due.localeCompare(b.due);
      const prio = { high: 0, mid: 1, low: 2 };
      return (prio[a.priority] || 1) - (prio[b.priority] || 1);
    })
    .slice(0, 3)
    .map(t => t.id);

  return json({ suggestions: fallback, message: '今日も一歩ずつがんばろ〜！🐾' });
}
