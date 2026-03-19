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
  ] = await Promise.all([
    env.DB.prepare(`SELECT datetime, mood, tag, text FROM entries ORDER BY datetime DESC LIMIT 10`).all(),
    env.DB.prepare(`SELECT text, tag, priority, due FROM todos WHERE status = 'open' ORDER BY created_at DESC LIMIT 10`).all(),
    env.DB.prepare(`SELECT title, author, rating, status, note FROM books ORDER BY datetime DESC LIMIT 5`).all(),
    env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('char_system_prompt', 'char_name')`).all(),
  ]);

  // settings をマップ化
  const settings = {};
  settingsRows.forEach(r => { settings[r.key] = r.value; });

  const systemPrompt = settings['char_system_prompt'] || DEFAULT_SYSTEM_PROMPT;

  const contextText = `
今日の日付: ${today}

最近の日記（最新10件）:
${recentEntries.map((e) => `- ${e.datetime} [mood:${e.mood}] [tag:${e.tag}] ${e.text}`).join('\n') || 'なし'}

未完了ToDo:
${openTodos.map((t) => `- [${t.priority}] ${t.text} (期限:${t.due || 'なし'}) [tag:${t.tag}]`).join('\n') || 'なし'}

最近の読書:
${recentBooks.map((b) => `- ${b.title}（${b.author}）★${b.rating} [${b.status}] ${b.note || ''}`).join('\n') || 'なし'}
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
