// POST /api/embed-backfill
// 既存の日記データをVectorizeにバックフィルするエンドポイント
// embedding_log に未登録のエントリを50件ずつ処理する
// 完了するまで繰り返し呼び出してください: { processed, remaining } を確認

import { embedAndStore } from './_vectorize.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ env }) {
  if (!env.VECTORIZE) {
    return json({ error: 'VECTORIZE binding not configured. Run: wrangler vectorize create lifeos-vectors --dimensions=768 --metric=cosine' }, 503);
  }
  if (!env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY not configured' }, 503);
  }

  const BATCH_SIZE = 50;

  // embedding_log に未登録のエントリを取得
  const { results: toEmbed } = await env.DB.prepare(`
    SELECT e.id, e.datetime, e.tag, e.text
    FROM entries e
    LEFT JOIN embedding_log el ON el.source_type = 'entry' AND el.source_id = e.id
    WHERE el.source_id IS NULL
      AND e.text IS NOT NULL
      AND e.text != ''
    ORDER BY e.datetime DESC
    LIMIT ?
  `).bind(BATCH_SIZE).all();

  let processed = 0;
  const errors = [];

  for (const entry of toEmbed) {
    try {
      const text = `${entry.datetime} ${entry.tag ? `[${entry.tag}]` : ''} ${entry.text}`.trim();
      await embedAndStore({
        env,
        sourceType: 'entry',
        sourceId: entry.id,
        text,
        metadata: { date: entry.datetime.slice(0, 10) },
      });
      processed++;
    } catch (e) {
      errors.push({ id: entry.id, error: e.message });
    }
  }

  // 残り件数を確認
  const { results: remainingCheck } = await env.DB.prepare(`
    SELECT COUNT(*) as cnt
    FROM entries e
    LEFT JOIN embedding_log el ON el.source_type = 'entry' AND el.source_id = e.id
    WHERE el.source_id IS NULL
      AND e.text IS NOT NULL
      AND e.text != ''
  `).all();
  const remaining = remainingCheck[0]?.cnt || 0;

  return json({
    processed,
    remaining,
    errors: errors.length > 0 ? errors : undefined,
    done: remaining === 0,
    message: remaining === 0
      ? 'バックフィル完了！全エントリのエンベディングが完了しました。'
      : `${processed}件処理しました。残り${remaining}件あります。再度呼び出してください。`,
  });
}
