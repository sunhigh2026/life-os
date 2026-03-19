function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/chat
export async function onRequestPost({ request, env }) {
  const { message } = await request.json();
  if (!message) return json({ error: 'message required' }, 400);

  if (!env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY not configured' }, 500);
  }

  const today = new Date().toISOString().slice(0, 10);

  // コンテキスト用データを取得
  const [{ results: recentEntries }, { results: openTodos }, { results: recentBooks }] =
    await Promise.all([
      env.DB.prepare(`SELECT datetime, mood, tag, text FROM entries ORDER BY datetime DESC LIMIT 10`).all(),
      env.DB.prepare(`SELECT text, tag, priority, due FROM todos WHERE status = 'open' ORDER BY created_at DESC LIMIT 10`).all(),
      env.DB.prepare(`SELECT title, author, rating, status, note FROM books ORDER BY datetime DESC LIMIT 5`).all(),
    ]);

  const contextText = `
今日の日付: ${today}

最近の日記（最新10件）:
${recentEntries.map((e) => `- ${e.datetime} [mood:${e.mood}] [tag:${e.tag}] ${e.text}`).join('\n') || 'なし'}

未完了ToDo:
${openTodos.map((t) => `- [${t.priority}] ${t.text} (期限:${t.due || 'なし'}) [tag:${t.tag}]`).join('\n') || 'なし'}

最近の読書:
${recentBooks.map((b) => `- ${b.title}（${b.author}）★${b.rating} [${b.status}] ${b.note || ''}`).join('\n') || 'なし'}
`.trim();

  const systemPrompt = `あなたはユーザーの個人ライフアシスタントです。ゆるくて親しみやすい口調（「〜だよ」「〜だね」「〜してみて！」）で話します。
ユーザーの日記・ToDo・読書記録を把握しており、それをもとに適切なアドバイスや振り返りを提供します。
回答は簡潔に、200文字以内を目安にしてください。`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${env.GEMINI_API_KEY}`,
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
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'うまく答えられなかったよ…ごめんね！';

    return json({ reply });
  } catch (e) {
    return json({ error: 'Gemini API error', detail: e.message }, 502);
  }
}
