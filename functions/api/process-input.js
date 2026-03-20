function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/process-input — AI分類エンドポイント
// 入力テキストを分析して、ToDo / 日記 / 質問のどれかに分類し、適切な補完情報を返す
export async function onRequestPost({ request, env }) {
  const { text } = await request.json();
  if (!text) return json({ error: 'text required' }, 400);

  const today = new Date().toISOString().slice(0, 10);

  // 既存タグを取得（AI補完用）
  let existingTags = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT tag, COUNT(*) as cnt FROM entries WHERE tag IS NOT NULL GROUP BY tag
       UNION
       SELECT tag, COUNT(*) as cnt FROM todos WHERE tag IS NOT NULL GROUP BY tag
       ORDER BY cnt DESC LIMIT 10`
    ).all();
    existingTags = results.map(r => r.tag);
  } catch (_) {}

  const prompt = `あなたはテキスト分類アシスタントです。
今日は${today}。

以下のテキストを分析して、分類とメタ情報を返してください。

テキスト: 「${text}」

分類ルール:
1. "todo" — やるべきこと・タスク・予定（「〜する」「〜買う」「〜に行く」「〜を提出」）
2. "diary" — 日記・感想・記録・つぶやき（「〜した」「〜だった」「〜な気持ち」）
3. "query" — 質問・相談（「〜って何？」「〜どうしたら？」「〜教えて」「おすすめは？」）

既存タグ一覧: ${existingTags.join(', ') || 'なし'}

以下のJSON形式で返答してください（他の文章は不要）:
{
  "mode": "todo" | "diary" | "query",
  "confidence": 0.0〜1.0,
  "suggested_tag": "適切なタグ（既存タグから選ぶか新規）",
  "suggested_priority": "high" | "mid" | "low",
  "suggested_category": "must" | "want" | null,
  "suggested_mood": 1〜6 | null,
  "suggested_due": "YYYY-MM-DD" | null,
  "reason": "分類理由を10字以内で"
}

todoの場合:
- 緊急性・義務感があれば priority=high, category=must
- やりたいこと系なら category=want
- 日付表現があれば suggested_due に変換

diaryの場合:
- 感情表現から mood を推定（1:悲しい 2:落ち込み 3:普通 4:良い 5:嬉しい 6:最高）

queryの場合:
- priority, category, mood は null`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
      }
    );

    if (!res.ok) {
      return json({ mode: 'diary', confidence: 0, reason: 'AI error' });
    }

    const data = await res.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return json({
        mode: parsed.mode || 'diary',
        confidence: parsed.confidence || 0,
        suggested_tag: parsed.suggested_tag || null,
        suggested_priority: parsed.suggested_priority || 'mid',
        suggested_category: parsed.suggested_category || null,
        suggested_mood: parsed.suggested_mood || null,
        suggested_due: parsed.suggested_due || null,
        reason: parsed.reason || '',
      });
    }
  } catch (_) {}

  // フォールバック: 簡易ルールベース分類
  const todoKeywords = ['する', '買う', '行く', '提出', '連絡', '予約', '準備', '確認', '申請', '送る'];
  const queryKeywords = ['?', '？', '教えて', 'どう', '何', 'おすすめ', 'なぜ'];

  const isTodo = todoKeywords.some(k => text.includes(k));
  const isQuery = queryKeywords.some(k => text.includes(k));

  return json({
    mode: isQuery ? 'query' : isTodo ? 'todo' : 'diary',
    confidence: 0.3,
    suggested_tag: null,
    suggested_priority: 'mid',
    suggested_category: null,
    suggested_mood: null,
    suggested_due: null,
    reason: 'ルールベース',
  });
}
