function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/todo-decompose — AIがタスクをサブタスクに分解
export async function onRequestPost({ request, env }) {
  const { id, text } = await request.json();
  if (!text) return json({ error: 'text required' }, 400);

  const today = new Date().toISOString().slice(0, 10);

  // 既存タスク情報を取得（idがあれば）
  let taskInfo = '';
  if (id) {
    const task = await env.DB.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first();
    if (task) {
      taskInfo = `\n元タスク詳細: 優先度:${task.priority} 期限:${task.due || 'なし'} タグ:${task.tag || 'なし'} 分類:${task.category || '未分類'}`;
    }
  }

  const prompt = `あなたはタスク分解アシスタント「ピアちゃん」です。
今日は${today}。以下のタスクを具体的な実行ステップに分解してください。
${taskInfo}

分解するタスク: 「${text}」

【最重要ルール】各ステップは「何をするか」が具体的にわかる行動にしてください。
各ステップが「椅子に座って30分で取りかかれる行動」になっていることが基準です。
「準備する」「実行する」「確認する」のような抽象的な表現は禁止です。

悪い例: 元タスク「開店祝い贈る」
× 開店祝いの準備
× 開店祝いを実行
× 開店祝いの確認

良い例: 元タスク「開店祝い贈る」
○ 予算と贈り物の候補を決める（花/酒/カタログギフト等）
○ 店の住所と開店日を確認する
○ ネットまたは店舗で注文・手配する
○ メッセージカードの文面を考えて添える
○ 届いたか確認の連絡をする

ルール:
- 3〜6件のステップに分解
- 各ステップは15〜30分で終わる粒度
- 最初のステップは今すぐ始められるくらい具体的に
- サブタスク名は短く（25文字以内）
- 必要に応じて期限（今日以降）を付ける

以下のJSON形式で返答してください（他の文章は不要）:
{"subtasks":[{"text":"具体的なアクション名","due":"YYYY-MM-DD or null"}],"comment":"ピアちゃん口調で一言アドバイス（30字以内）"}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
        }),
      }
    );

    if (!res.ok) {
      return json({ error: 'AI API error' }, 502);
    }

    const data = await res.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return json({
        subtasks: parsed.subtasks || [],
        comment: parsed.comment || '一歩ずつやっていこ〜！',
      });
    }
  } catch (_) {}

  // フォールバック（AI失敗時は具体化を促すメッセージ）
  return json({
    subtasks: [
      { text: `${text}に必要な情報を調べてメモする`, due: null },
      { text: `${text}の具体的な段取りを書き出す`, due: null },
      { text: `${text}の最初の一手を実行する`, due: null },
    ],
    comment: 'AIがうまく動かなかったけど、まずはここから！',
  });
}
