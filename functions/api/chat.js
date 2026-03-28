import { callGemini } from './_gemini.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function _getPeriod(freq, goalStart, goalDeadline) {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const today = `${y}-${m}-${d}`;

  if (freq === 'daily') return { start: today, end: today };
  if (freq === 'weekly') {
    const day = jst.getUTCDay();
    const off = day === 0 ? -6 : 1 - day;
    const mon = new Date(jst); mon.setUTCDate(mon.getUTCDate() + off);
    const sun = new Date(mon); sun.setUTCDate(sun.getUTCDate() + 6);
    const f = dt => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
    return { start: f(mon), end: f(sun) };
  }
  if (freq === 'monthly') return { start: `${y}-${m}-01`, end: `${y}-${m}-31` };
  if (freq === 'yearly') return { start: `${y}-01-01`, end: `${y}-12-31` };
  if (freq === 'once' && goalStart && goalDeadline) return { start: goalStart, end: goalDeadline };
  return { start: `${y}-${m}-01`, end: `${y}-${m}-31` };
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
目標の進捗を聞かれたら、現在の達成率を見て、達成に向けた具体的なアドバイスをする。
達成率が高ければ褒める。低ければ無理のない提案をする。期限が近いなら注意を促す。
回答は簡潔に。ただし必要な情報は省略しない。`;

// 重量タスク判定（pro モデルを使うキーワード）
const HEAVY_KEYWORDS = ['まとめ', '分析', 'レポート', '傾向', '比較', '統計', '評価', '改善', '提案して', 'アドバイス'];
function detectHeavyTask(msg) {
  return HEAVY_KEYWORDS.some(k => msg.includes(k));
}

// RAG必要性判定（過去の記録を検索すべきキーワード）
const RAG_KEYWORDS = ['前に', '以前', '先月', '先週', '去年', 'あの時', '覚えてる', '覚えている', '日記', '書いた', 'いつ', '何回', '最後に', 'これまで', '過去'];
function needsRAG(msg) {
  return RAG_KEYWORDS.some(k => msg.includes(k));
}

// POST /api/chat
export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { message, session_id } = body;
  if (!message) return json({ error: 'message required' }, 400);
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not configured' }, 500);

  // モデル選択: クライアント指定 > キーワード判定 > デフォルト
  const model = body.mode === 'pro' || detectHeavyTask(message) ? 'pro' : 'flash';

  const today = new Date().toISOString().slice(0, 10);

  // コンテキスト + キャラ設定を並行取得（日記は3件に削減、RAGで補完）
  const [
    { results: recentEntries },
    { results: openTodos },
    { results: recentBooks },
    { results: settingsRows },
    { results: fitnessData },
    { results: activeGoals },
    { results: menstrualDates },
  ] = await Promise.all([
    env.DB.prepare(`SELECT datetime, mood, tag, text FROM entries ORDER BY datetime DESC LIMIT 3`).all(),
    env.DB.prepare(`SELECT text, tag, priority, due, category FROM todos WHERE status = 'open' AND parent_id IS NULL ORDER BY created_at DESC LIMIT 10`).all(),
    env.DB.prepare(`SELECT title, author, rating, status, note FROM books ORDER BY datetime DESC LIMIT 5`).all(),
    env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('char_system_prompt', 'char_name', 'gcal_access_token', 'gcal_refresh_token', 'gcal_token_expires')`).all(),
    env.DB.prepare(`SELECT date, steps, active_minutes, weight FROM fitness ORDER BY date DESC LIMIT 7`).all(),
    env.DB.prepare(`SELECT goal, target, unit, freq, start, deadline, memo, status FROM goals WHERE status = 'active' LIMIT 5`).all(),
    env.DB.prepare(`SELECT DISTINCT substr(datetime, 1, 10) as date FROM entries WHERE (text LIKE '%生理始まった%' OR text LIKE '%生理開始%' OR text LIKE '%生理きた%' OR text LIKE '%生理来た%' OR text LIKE '%生理なった%' OR text LIKE '%生理1日目%' OR text LIKE '%生理１日目%') AND text NOT LIKE '%生理管理%' AND text NOT LIKE '%生理用品%' ORDER BY date DESC LIMIT 5`).all(),
  ]);

  const settings = {};
  settingsRows.forEach(r => { settings[r.key] = r.value; });
  const systemPrompt = settings['char_system_prompt'] || DEFAULT_SYSTEM_PROMPT;

  // カレンダー予定取得
  let calendarText = '';
  if (settings.gcal_refresh_token && settings.gcal_access_token) {
    try {
      let accessToken = settings.gcal_access_token;
      if (settings.gcal_token_expires && Date.now() >= Number(settings.gcal_token_expires)) {
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
      const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const ymd = jst.toISOString().slice(0, 10);
      const timeMin = new Date(ymd + 'T00:00:00+09:00');
      const timeMax = new Date(ymd + 'T00:00:00+09:00');
      timeMax.setDate(timeMax.getDate() + 2);

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
    } catch (_) {}
  }

  // RAG: 過去の記録をベクトル検索（Vectorize が設定されていて、過去関連クエリの場合のみ）
  let ragContext = '';
  if (needsRAG(message) && env.VECTORIZE) {
    try {
      const { getEmbedding } = await import('./_gemini.js');
      const queryVector = await getEmbedding({ ai: env.AI, text: message });
      if (queryVector.length > 0) {
        const results = await env.VECTORIZE.query(queryVector, { topK: 5, returnMetadata: true });
        const hits = results.matches || [];
        if (hits.length > 0) {
          // D1 から本文取得
          const ragLines = [];
          for (const hit of hits) {
            const meta = hit.metadata || {};
            const { source_type, source_id, date, preview } = meta;
            if (!source_type || !source_id) continue;
            try {
              let fullText = preview || '';
              if (source_type === 'entry') {
                const row = await env.DB.prepare(`SELECT datetime, mood, tag, text FROM entries WHERE id = ?`).bind(source_id).first();
                if (row?.text) fullText = row.text.slice(0, 300);
                if (row) ragLines.push(`[${row.datetime?.slice(0,10) || date}] 日記: ${fullText}`);
              } else if (source_type === 'chat') {
                const row = await env.DB.prepare(`SELECT content, created_at FROM chat_messages WHERE id = ?`).bind(source_id).first();
                if (row?.content) ragLines.push(`[${row.created_at?.slice(0,10) || date}] 過去の会話: ${row.content.slice(0, 200)}`);
              }
            } catch (_) {}
          }
          if (ragLines.length > 0) {
            ragContext = `\n\n【関連する過去の記録（ベクトル検索）】\n${ragLines.join('\n')}`;
          }
        }
      }
    } catch (_) {}
  }

  // 目標進捗計算
  const goalLines = activeGoals.length
    ? await Promise.all(activeGoals.map(async g => {
        let current = 0;
        const period = _getPeriod(g.freq, g.start, g.deadline);
        if (period && g.target) {
          if (g.unit === '冊') {
            const r = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM books WHERE status = 'done' AND datetime BETWEEN ? AND ?`).bind(period.start, period.end + 'T23:59:59').first();
            current = r?.cnt || 0;
          } else if (g.unit === '歩') {
            const r = await env.DB.prepare(`SELECT AVG(steps) as v FROM fitness WHERE date BETWEEN ? AND ?`).bind(period.start, period.end).first();
            current = Math.round(r?.v || 0);
          } else if (g.unit === '回') {
            const r = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM entries WHERE datetime BETWEEN ? AND ?`).bind(period.start, period.end + 'T23:59:59').first();
            current = r?.cnt || 0;
          } else if (g.unit === '分') {
            const r = await env.DB.prepare(`SELECT AVG(active_minutes) as v FROM fitness WHERE date BETWEEN ? AND ?`).bind(period.start, period.end).first();
            current = Math.round(r?.v || 0);
          } else if (g.unit === 'kg') {
            const r = await env.DB.prepare(`SELECT weight FROM fitness WHERE weight IS NOT NULL ORDER BY date DESC LIMIT 1`).first();
            current = r?.weight || 0;
          }
        }
        if (g.target) {
          const pct = Math.min(100, Math.round((current / g.target) * 100));
          return `- ${g.goal}（目標:${g.target}${g.unit}/${g.freq || ''}）→ 現在:${current}${g.unit} (${pct}%)${g.deadline ? ` 期限:${g.deadline}` : ''}${g.memo ? ` メモ:${g.memo}` : ''}`;
        }
        return `- ${g.goal}（定性目標）${g.deadline ? ` 期限:${g.deadline}` : ''}${g.memo ? ` メモ:${g.memo}` : ''}`;
      }))
    : ['未設定'];

  const contextText = `
今日の日付: ${today}

最近の日記（直近3件）:
${recentEntries.map(e => `- ${e.datetime} [mood:${e.mood}] [tag:${e.tag}] ${e.text}`).join('\n') || 'なし'}

未完了ToDo:
${openTodos.map(t => `- [${t.priority}]${t.category ? `[${t.category}]` : ''} ${t.text} (期限:${t.due || 'なし'}) [tag:${t.tag}]`).join('\n') || 'なし'}

最近の読書:
${recentBooks.map(b => `- ${b.title}（${b.author}）★${b.rating} [${b.status}] ${b.note || ''}`).join('\n') || 'なし'}

直近のフィットネス:
${fitnessData.length ? fitnessData.map(f => `- ${f.date} 歩数:${f.steps || '-'} 運動:${f.active_minutes || '-'}分 体重:${f.weight || '-'}kg`).join('\n') : 'データなし'}

目標と進捗:
${goalLines.join('\n')}

生理記録日（直近5回の開始日付近）:
${menstrualDates.length ? menstrualDates.map(d => d.date).join(', ') : '記録なし'}${calendarText}${ragContext}
`.trim();

  // スライディングウィンドウ: 同一セッションの直近3往復（6メッセージ）
  let previousMessages = [];
  if (session_id) {
    try {
      const { results: history } = await env.DB.prepare(
        `SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 6`
      ).bind(session_id).all();
      // DESC で取得しているので反転して時系列順に
      previousMessages = history.reverse().map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      }));
    } catch (_) {}
  }

  // ユーザーメッセージをDBに保存
  const userMsgId = crypto.randomUUID();
  if (session_id) {
    try {
      await env.DB.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, 'user', ?)`
      ).bind(userMsgId, session_id, message).run();
    } catch (_) {}
  }

  // Gemini contents 構築（マルチターン形式）
  const contents = [
    { role: 'user', parts: [{ text: `${systemPrompt}\n\n【コンテキスト】\n${contextText}` }] },
    { role: 'model', parts: [{ text: 'わかったよ！なんでも聞いてね🐾' }] },
    ...previousMessages,
    { role: 'user', parts: [{ text: message }] },
  ];

  try {
    const replyText = await callGemini({
      apiKey: env.GEMINI_API_KEY,
      model,
      contents,
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
    });

    const reply = replyText || 'うまく答えられなかったよ…ごめんね！';

    // AIの応答をDBに保存
    if (session_id) {
      try {
        await env.DB.prepare(
          `INSERT INTO chat_messages (id, session_id, role, content, model) VALUES (?, ?, 'assistant', ?, ?)`
        ).bind(crypto.randomUUID(), session_id, reply, model).run();
      } catch (_) {}
    }

    // ユーザーメッセージをVectorizeにエンベディング（session_idがある場合のみ）
    if (session_id && env.VECTORIZE) {
      try {
        const { embedAndStore } = await import('./_vectorize.js');
        await embedAndStore({
          env,
          sourceType: 'chat',
          sourceId: userMsgId,
          text: message,
          metadata: { date: today },
        });
      } catch (_) {}
    }

    return json({ reply, charName: settings['char_name'] || null, model });
  } catch (e) {
    return json({ error: 'Gemini API error', detail: e.message }, 502);
  }
}
