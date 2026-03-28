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

  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = jst.toISOString().slice(0, 10);

  // 既存タスク情報を取得（idがあれば）
  let taskInfo = '';
  if (id) {
    try {
      const task = await env.DB.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first();
      if (task) {
        taskInfo = `\n元タスク詳細: 優先度:${task.priority} 期限:${task.due || 'なし'} タグ:${task.tag || 'なし'} 分類:${task.category || '未分類'}`;
      }
    } catch (_) {}
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

  if (!env.GEMINI_API_KEY) {
    return json({ subtasks: [], comment: 'GEMINI_API_KEYが設定されていません', _debug: 'no_key' });
  }

  try {
    const { callGemini, extractJson } = await import('./_gemini.js');
    const responseText = await callGemini({
      apiKey: env.GEMINI_API_KEY,
      model: 'flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
    });

    if (!responseText) {
      return json({
        subtasks: [
          { text: `${text}に必要な情報を調べてメモする`, due: null },
          { text: `${text}の具体的な段取りを書き出す`, due: null },
        ],
        comment: 'AIの返答が空だったよ〜',
      });
    }

    const parsed = extractJson(responseText);
    if (parsed && parsed.subtasks && parsed.subtasks.length > 0) {
      return json({
        subtasks: parsed.subtasks,
        comment: parsed.comment || '一歩ずつやっていこ〜！',
      });
    }

    return json({
      subtasks: [
        { text: `${text}に必要な情報を調べてメモする`, due: null },
        { text: `${text}の具体的な段取りを書き出す`, due: null },
      ],
      comment: 'AIの返答を解析できなかったよ〜',
    });
  } catch (e) {
    return json({
      subtasks: [
        { text: `${text}に必要な情報を調べてメモする`, due: null },
        { text: `${text}の具体的な段取りを書き出す`, due: null },
      ],
      comment: 'AIがうまく動かなかったけど、まずはここから！',
      _debug: `catch: ${e.message}`,
    });
  }
}
