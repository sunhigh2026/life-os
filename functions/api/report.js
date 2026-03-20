function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function jstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

// 今週の月曜〜日曜（JST）を返す
function jstThisWeekRange() {
  const jst = jstNow();
  const day = jst.getUTCDay(); // 0=日, 1=月, …, 6=土
  const toMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(jst);
  mon.setUTCDate(jst.getUTCDate() + toMon);
  const monStr = mon.toISOString().slice(0, 10);
  const nextMon = new Date(monStr + 'T00:00:00Z');
  nextMon.setUTCDate(nextMon.getUTCDate() + 7);
  return { from: monStr, to: nextMon.toISOString().slice(0, 10) };
}

// 来週の月曜〜日曜（JST）を返す
function jstNextWeekRange() {
  const { to: from } = jstThisWeekRange();
  const nextTo = new Date(from + 'T00:00:00Z');
  nextTo.setUTCDate(nextTo.getUTCDate() + 7);
  return { from, to: nextTo.toISOString().slice(0, 10) };
}

// ==============================
// データ収集
// ==============================
async function gatherWeeklyData(db, from, to) {
  const [entriesRes, doneTodosRes, openTodosRes, booksRes, fitnessRes] = await Promise.all([
    db.prepare(
      `SELECT datetime, mood, tag, text FROM entries WHERE datetime >= ? AND datetime < ? ORDER BY datetime`
    ).bind(from, to).all(),
    db.prepare(
      `SELECT text, done_at FROM todos WHERE status = 'done' AND done_at >= ? AND done_at < ? ORDER BY done_at`
    ).bind(from, to).all(),
    db.prepare(
      `SELECT text, due FROM todos WHERE status != 'done' ORDER BY due ASC NULLS LAST LIMIT 50`
    ).all(),
    db.prepare(
      `SELECT title, author, cover_url, rating, note, status FROM books WHERE datetime >= ? AND datetime < ?`
    ).bind(from, to).all(),
    db.prepare(
      `SELECT date, steps, active_minutes FROM fitness WHERE date >= ? AND date < ? ORDER BY date`
    ).bind(from, to).all(),
  ]);

  return {
    entries:      entriesRes.results  || [],
    doneTodos:    doneTodosRes.results || [],
    openTodos:    openTodosRes.results || [],
    books:        booksRes.results    || [],
    fitnessPerDay: fitnessRes.results || [],
  };
}

async function gatherLastWeekStats(db, from) {
  const lFrom = formatDate(new Date(new Date(from + 'T00:00:00Z').getTime() - 7 * 86400000));
  const lTo = from;
  const [entries, done, books, fit] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as c, AVG(mood) as m FROM entries WHERE datetime >= ? AND datetime < ?`).bind(lFrom, lTo).first(),
    db.prepare(`SELECT COUNT(*) as c FROM todos WHERE status = 'done' AND done_at >= ? AND done_at < ?`).bind(lFrom, lTo).first(),
    db.prepare(`SELECT COUNT(*) as c FROM books WHERE datetime >= ? AND datetime < ?`).bind(lFrom, lTo).first(),
    db.prepare(`SELECT AVG(steps) as s FROM fitness WHERE date >= ? AND date < ?`).bind(lFrom, lTo).first(),
  ]);
  return {
    entryCount: entries.c || 0,
    avgMood:    entries.m ? Math.round(entries.m * 10) / 10 : null,
    todoDone:   done.c || 0,
    bookCount:  books.c || 0,
    avgSteps:   fit.s ? Math.round(fit.s) : null,
  };
}

async function gatherNextWeekTodos(db, nextFrom, nextTo) {
  const res = await db.prepare(
    `SELECT text, due FROM todos WHERE status != 'done' AND due >= ? AND due < ? ORDER BY due`
  ).bind(nextFrom, nextTo).all();
  return res.results || [];
}

// ==============================
// Google Calendar（calendar.js から複製）
// ==============================
async function getValidCalendarToken(env) {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN ('gcal_access_token','gcal_refresh_token','gcal_token_expires')`
  ).all();
  const m = {};
  results.forEach(r => { m[r.key] = r.value; });
  if (!m.gcal_access_token || !m.gcal_refresh_token) return null;
  if (m.gcal_token_expires && Date.now() < Number(m.gcal_token_expires)) return m.gcal_access_token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: m.gcal_refresh_token, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  const expiresAt = Date.now() + (d.expires_in - 60) * 1000;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('gcal_access_token',?)`).bind(d.access_token),
    env.DB.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('gcal_token_expires',?)`).bind(String(expiresAt)),
  ]);
  return d.access_token;
}

async function fetchCalendarEvents(accessToken, fromDate, toDate) {
  const params = new URLSearchParams({
    timeMin: new Date(fromDate + 'T00:00:00+09:00').toISOString(),
    timeMax: new Date(toDate + 'T00:00:00+09:00').toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '50', timeZone: 'Asia/Tokyo',
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).map(ev => {
    const isAllDay = !!ev.start?.date;
    const startDT = ev.start?.dateTime;
    const endDT   = ev.end?.dateTime;
    return {
      title:    ev.summary || '(タイトルなし)',
      date:     (ev.start?.date || ev.start?.dateTime || '').slice(0, 10),
      startTime: isAllDay ? '終日' : startDT ? startDT.slice(11, 16) : '',
      endTime:   isAllDay ? ''     : endDT   ? endDT.slice(11, 16)   : '',
      allDay:    isAllDay,
      location:  ev.location || '',
    };
  });
}

// ==============================
// Gemini: 構造化コメント生成
// ==============================
async function generateStructuredComment(apiKey, { entries, doneTodos, openTodos, books, fitnessPerDay, lastWeek, nextWeekEvents, nextWeekTodos }) {
  const prompt = `
あなたは「ピアちゃん」。もちもちしたピンクのゆるキャラ。おっとりした口調で話す。褒めるときはしっかり褒める。ちょっとおせっかいだけど押しつけがましくない。絵文字を適度に使う（1〜2個/セクション）。

以下のデータをもとに週次レポートのコメントをJSON形式で生成してください。

## 出力フォーマット
{
  "summary": "今週の一言サマリー。2文以内。読んだ人が最初に目にする部分",
  "best_moment": {
    "date": "YYYY-MM-DD",
    "mood": 数値,
    "quote": "日記テキストの引用（30字以内に要約可）",
    "comment": "ピアちゃんのコメント1〜2文"
  },
  "tough_moment": {
    "date": "YYYY-MM-DD",
    "mood": 数値,
    "quote": "日記テキストの引用（30字以内に要約可）",
    "comment": "共感と励まし1〜2文。解決策は押しつけない"
  },
  "todo_comment": "ToDo消化率へのコメント。完了を褒めつつ、持ち越しがあれば無理しないでねとフォロー。2〜3文",
  "book_comment": "読書に関するコメント。読了があれば感想に触れる。なければ来週の提案。1〜2文",
  "fitness_comment": "歩数データへのコメント。最多日と最少日に触れて1〜2文",
  "next_week_advice": [
    "来週の予定とToDoを見て具体的な提案1",
    "来週の予定とToDoを見て具体的な提案2",
    "来週の予定とToDoを見て具体的な提案3"
  ]
}

## ルール
- 各コメントは短く。1セクション3文以内。
- 数字の羅列はしない（数字はUI側で表示する）。
- ネガティブなことも受け止めるが、説教しない。
- next_week_adviceはカレンダー予定とToDoの期限を踏まえた具体的な内容にする。
- 日記が0件の場合はbest_momentとtough_momentをnullにする。
- JSONのみ出力。マークダウンや説明文は不要。

## 今週のデータ
### 日記（${entries.length}件）
${entries.map(e => `${e.datetime} mood:${e.mood} tag:${e.tag || 'なし'} "${(e.text || '').slice(0, 100)}"`).join('\n') || 'なし'}

### ToDo完了（${doneTodos.length}件）
${doneTodos.map(t => `✓ ${t.text}`).join('\n') || 'なし'}

### ToDo未完了（${openTodos.length}件）
${openTodos.map(t => `□ ${t.text} 期限:${t.due || 'なし'}`).join('\n') || 'なし'}

### 読書（${books.length}冊）
${books.map(b => `「${b.title}」★${b.rating || '-'} ${b.note || ''}`).join('\n') || 'なし'}

### 歩数
${fitnessPerDay.map(f => `${f.date}: ${f.steps || 0}歩 ${f.active_minutes || 0}分`).join('\n') || 'なし'}

### 先週の数値（比較用）
日記:${lastWeek.entryCount}件 / mood:${lastWeek.avgMood ?? '-'} / ToDo完了:${lastWeek.todoDone}件 / 読書:${lastWeek.bookCount}冊 / 平均歩数:${lastWeek.avgSteps ?? '-'}

### 来週のカレンダー予定
${nextWeekEvents.map(e => `${e.date} ${e.startTime}${e.endTime ? '-' + e.endTime : ''} ${e.title}${e.location ? ' @' + e.location : ''}`).join('\n') || 'なし'}

### 来週期限のToDo
${nextWeekTodos.map(t => `□ ${t.text} 期限:${t.due}`).join('\n') || 'なし'}
`.trim();

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
  );
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return { summary: raw.slice(0, 200), best_moment: null, tough_moment: null,
             todo_comment: '', book_comment: '', fitness_comment: '', next_week_advice: [] };
  }
}

// ==============================
// Mood・グラフ用データ構築
// ==============================
function buildMoodByDay(entries, from) {
  const labels = ['月', '火', '水', '木', '金', '土', '日'];
  const byDate = {};
  entries.forEach(e => {
    const d = (e.datetime || '').slice(0, 10);
    if (d) { if (!byDate[d]) byDate[d] = []; byDate[d].push(e.mood || 0); }
  });
  const moodEmoji = m => ['', '😢', '😞', '😐', '🙂', '😊', '🤩'][Math.round(m)] || '➖';
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(from + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const moods = byDate[dateStr] || [];
    const avg = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
    return { date: dateStr, day: labels[i], avgMood: avg ? Math.round(avg * 10) / 10 : null,
             emoji: avg ? moodEmoji(avg) : null, count: moods.length };
  });
}

// ==============================
// メール HTML
// ==============================
function buildEmailHtml(weekData, stats, piaComment, lastWeek, periodLabel) {
  const { doneTodos, openTodos, books, fitnessPerDay } = weekData;
  const moodEmoji = m => ['', '😢', '😞', '😐', '🙂', '😊', '🤩'][Math.round(m)] || '➖';

  const delta = (cur, prev, positiveGood = true) => {
    if (prev == null || cur == null) return '';
    const d = Math.round((cur - prev) * 10) / 10;
    if (d === 0) return `<span style="color:#9ca3af;font-size:11px;">±0</span>`;
    const good = positiveGood ? d > 0 : d < 0;
    return `<span style="color:${good ? '#10b981' : '#ef4444'};font-size:11px;">${d > 0 ? '↑' : '↓'}${Math.abs(d)}</span>`;
  };

  const card = (emoji, label, value, deltaHtml = '') =>
    `<td style="background:#f0faf7;border-radius:10px;padding:12px;text-align:center;width:33%;">
      <div style="font-size:20px;">${emoji}</div>
      <div style="font-size:11px;color:#7A9490;">${label}</div>
      <div style="font-size:18px;font-weight:700;color:#2D3B36;">${value}</div>
      ${deltaHtml}
    </td>`;

  const adviceItems = (piaComment.next_week_advice || [])
    .map(a => `<li style="margin-bottom:6px;font-size:13px;color:#2D3B36;">${a}</li>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F5FBF8;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#7EC8B0,#5BA68A);padding:28px 24px;text-align:center;">
    <div style="font-size:32px;">🐾</div>
    <h1 style="margin:8px 0 0;color:#fff;font-size:20px;font-weight:700;">ピアちゃんの週次レポート</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">${periodLabel}</p>
  </div>
  <div style="padding:20px 24px;">
    <div style="background:#EEF8F5;border-radius:12px;padding:16px;margin-bottom:20px;border-left:4px solid #7EC8B0;">
      <div style="font-weight:600;color:#5BA68A;margin-bottom:6px;">🐾 今週のサマリー</div>
      <p style="margin:0;color:#2D3B36;font-size:14px;line-height:1.7;">${piaComment.summary || ''}</p>
    </div>

    <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:8px;">
      <tr>
        ${card('📝', '日記', `${stats.entryCount}件`, delta(stats.entryCount, lastWeek?.entryCount))}
        ${card(stats.avgMood ? moodEmoji(stats.avgMood) : '➖', '平均mood', stats.avgMood ?? '—', delta(stats.avgMood, lastWeek?.avgMood))}
        ${card('✅', 'ToDo完了', `${stats.todoCompleted}件`, delta(stats.todoCompleted, lastWeek?.todoDone))}
      </tr>
      <tr>
        ${card('📋', 'ToDo残', `${stats.todoRemaining}件`, delta(stats.todoRemaining, null))}
        ${card('📚', '読書', `${stats.booksFinished}冊`, delta(stats.booksFinished, lastWeek?.bookCount))}
        ${card('🚶', '平均歩数', stats.avgSteps ? `${stats.avgSteps.toLocaleString()}` : '—', delta(stats.avgSteps, lastWeek?.avgSteps))}
      </tr>
    </table>

    ${piaComment.todo_comment ? `
    <div style="background:#f9fafb;border-radius:10px;padding:14px;margin-top:16px;">
      <div style="font-weight:600;color:#5BA68A;margin-bottom:4px;">✅ ToDo</div>
      <p style="margin:0;font-size:13px;color:#2D3B36;line-height:1.7;">${piaComment.todo_comment}</p>
    </div>` : ''}

    ${books.length ? `
    <div style="background:#f9fafb;border-radius:10px;padding:14px;margin-top:12px;">
      <div style="font-weight:600;color:#5BA68A;margin-bottom:4px;">📚 読書</div>
      ${books.map(b => `<div style="font-size:13px;color:#2D3B36;">「${b.title}」${'★'.repeat(b.rating || 0)}</div>`).join('')}
      ${piaComment.book_comment ? `<p style="margin:6px 0 0;font-size:13px;color:#7A9490;line-height:1.7;">${piaComment.book_comment}</p>` : ''}
    </div>` : ''}

    ${adviceItems ? `
    <div style="background:#EEF8F5;border-radius:10px;padding:14px;margin-top:16px;">
      <div style="font-weight:600;color:#5BA68A;margin-bottom:8px;">🌿 来週へのアドバイス</div>
      <ul style="margin:0;padding-left:18px;">${adviceItems}</ul>
    </div>` : ''}
  </div>
  <div style="padding:12px 24px;text-align:center;color:#9ca3af;font-size:11px;border-top:1px solid #f3f4f6;">
    Life OS — あなたの毎日をサポート 🐾
  </div>
</div>
</body></html>`;
}

async function sendEmail(env, subject, html) {
  if (!env.RESEND_API_KEY || !env.REPORT_EMAIL) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Life OS <noreply@resend.dev>', to: env.REPORT_EMAIL, subject, html }),
    });
    return res.ok;
  } catch { return false; }
}

// ==============================
// メインハンドラー
// ==============================
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'weekly';

  if (!['weekly', 'yearly'].includes(type)) {
    return json({ error: 'type must be "weekly" or "yearly"' }, 400);
  }

  // yearly は既存の簡易版を維持
  if (type === 'yearly') {
    const jst = jstNow();
    const to = formatDate(jst);
    const fromD = new Date(jst); fromD.setFullYear(fromD.getFullYear() - 1);
    const from = formatDate(fromD);
    try {
      const [entries, done, remaining, books, fit] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) as c, AVG(mood) as m FROM entries WHERE datetime >= ? AND datetime < ?`).bind(from, to).first(),
        env.DB.prepare(`SELECT COUNT(*) as c FROM todos WHERE status='done' AND done_at >= ? AND done_at < ?`).bind(from, to).first(),
        env.DB.prepare(`SELECT COUNT(*) as c FROM todos WHERE status!='done'`).first(),
        env.DB.prepare(`SELECT COUNT(*) as c FROM books WHERE status='done' AND datetime >= ? AND datetime < ?`).bind(from, to).first(),
        env.DB.prepare(`SELECT AVG(steps) as s FROM fitness WHERE date >= ? AND date < ?`).bind(from, to).first(),
      ]);
      const stats = {
        entryCount: entries.c || 0, avgMood: entries.m ? Math.round(entries.m * 10) / 10 : null,
        todoCompleted: done.c || 0, todoRemaining: remaining.c || 0,
        booksFinished: books.c || 0, avgSteps: fit.s ? Math.round(fit.s) : null,
      };
      return json({ stats, period: { from, to }, periodLabel: `${from} 〜 ${to}` });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  // ===== WEEKLY =====
  const { from, to } = jstThisWeekRange();
  const { from: nextFrom, to: nextTo } = jstNextWeekRange();
  const lastDayOfWeek = formatDate(new Date(new Date(to + 'T00:00:00Z').getTime() - 86400000));
  const periodLabel = `${from} 〜 ${lastDayOfWeek}`;

  try {
    const [weekData, lastWeek, nextWeekTodos] = await Promise.all([
      gatherWeeklyData(env.DB, from, to),
      gatherLastWeekStats(env.DB, from),
      gatherNextWeekTodos(env.DB, nextFrom, nextTo),
    ]);

    // カレンダー取得（失敗しても続行）
    let nextWeekEvents = [];
    try {
      const token = await getValidCalendarToken(env);
      if (token) nextWeekEvents = await fetchCalendarEvents(token, nextFrom, nextTo);
    } catch (_) {}

    // 集計
    const avgMood = weekData.entries.length
      ? Math.round((weekData.entries.reduce((s, e) => s + (e.mood || 0), 0) / weekData.entries.length) * 10) / 10
      : null;
    const avgSteps = weekData.fitnessPerDay.length
      ? Math.round(weekData.fitnessPerDay.reduce((s, f) => s + (f.steps || 0), 0) / weekData.fitnessPerDay.length)
      : null;

    const stats = {
      entryCount:    weekData.entries.length,
      avgMood,
      todoCompleted: weekData.doneTodos.length,
      todoRemaining: weekData.openTodos.length,
      booksFinished: weekData.books.length,
      avgSteps,
      moodByDay:     buildMoodByDay(weekData.entries, from),
    };

    // Gemini コメント生成
    let piaComment = {};
    try {
      piaComment = await generateStructuredComment(env.GEMINI_API_KEY, {
        ...weekData, lastWeek, nextWeekEvents, nextWeekTodos,
      });
    } catch (e) {
      piaComment = { summary: 'コメントの生成に失敗しました。', next_week_advice: [] };
      console.error('Gemini error:', e.message);
    }

    // メール送信
    const emailHtml = buildEmailHtml(weekData, stats, piaComment, lastWeek, periodLabel);
    const emailSent = await sendEmail(env, `🐾 ピアちゃんの週次レポート（${periodLabel}）`, emailHtml);

    return json({
      period: { from, to: lastDayOfWeek },
      periodLabel,
      stats,
      lastWeek,
      weekData: {
        entries:       weekData.entries,
        doneTodos:     weekData.doneTodos,
        openTodos:     weekData.openTodos,
        books:         weekData.books,
        fitnessPerDay: weekData.fitnessPerDay,
      },
      nextWeekEvents,
      nextWeekTodos,
      piaComment,
      emailSent,
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
