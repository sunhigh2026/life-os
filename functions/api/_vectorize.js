// Cloudflare Vectorize + Workers AI Embedding (bge-m3) ユーティリティ
// ベクトルID形式: "{source_type}:{source_id}"  例: "entry:uuid", "chat:uuid"
// メタデータ: { source_type, source_id, date, preview }

import { getEmbedding } from './_gemini.js';

/**
 * テキストをエンベディングしてVectorizeに保存する
 * エラーは呼び出し元に伝播させず、silent fail させること
 *
 * @param {Object} opts
 * @param {Object} opts.env        - Cloudflare env（VECTORIZE, GEMINI_API_KEY, DB が必要）
 * @param {string} opts.sourceType - 'entry' | 'chat' | 'book_note'
 * @param {string} opts.sourceId   - D1レコードのID
 * @param {string} opts.text       - エンベディングするテキスト
 * @param {Object} [opts.metadata] - 追加メタデータ（date等）
 */
export async function embedAndStore({ env, sourceType, sourceId, text, metadata = {} }) {
  if (!env.VECTORIZE || !env.AI) return;
  if (!text || text.trim().length === 0) return;

  const vectorId = `${sourceType}:${sourceId}`;
  const preview = text.slice(0, 100);

  const values = await getEmbedding({ ai: env.AI, text });
  if (!values || values.length === 0) return;

  await env.VECTORIZE.upsert([{
    id: vectorId,
    values,
    metadata: {
      source_type: sourceType,
      source_id: sourceId,
      date: metadata.date || '',
      preview,
    },
  }]);

  // embedding_log に記録（重複防止・バックフィル追跡）
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO embedding_log (source_type, source_id, embedded_at) VALUES (?, ?, datetime('now'))`
    ).bind(sourceType, sourceId).run();
  } catch (_) {}
}

/**
 * クエリテキストをベクトル化してVectorizeで類似検索する
 *
 * @param {Object} opts
 * @param {Object} opts.env      - Cloudflare env
 * @param {string} opts.queryText - 検索クエリ
 * @param {number} [opts.topK=5] - 返す件数
 * @param {string} [opts.filterSourceType] - 'entry' | 'chat' | 'book_note' | undefined（全種類）
 * @returns {Promise<Array>} マッチ結果の配列 { id, score, metadata }
 */
export async function searchSimilar({ env, queryText, topK = 5, filterSourceType }) {
  if (!env.VECTORIZE || !env.AI) return [];

  const queryVector = await getEmbedding({ ai: env.AI, text: queryText });
  if (!queryVector || queryVector.length === 0) return [];

  const queryOptions = { topK, returnMetadata: true };
  // Vectorize メタデータフィルタリング（source_type 指定時のみ）
  if (filterSourceType) {
    queryOptions.filter = { source_type: { $eq: filterSourceType } };
  }

  const results = await env.VECTORIZE.query(queryVector, queryOptions);
  return results.matches || [];
}

/**
 * Vectorizeからベクトルを削除する（エントリ削除時に使用）
 *
 * @param {Object} opts
 * @param {Object} opts.env
 * @param {string} opts.sourceType
 * @param {string} opts.sourceId
 */
export async function deleteVector({ env, sourceType, sourceId }) {
  if (!env.VECTORIZE) return;
  const vectorId = `${sourceType}:${sourceId}`;
  try {
    await env.VECTORIZE.deleteByIds([vectorId]);
    await env.DB.prepare(
      `DELETE FROM embedding_log WHERE source_type = ? AND source_id = ?`
    ).bind(sourceType, sourceId).run();
  } catch (_) {}
}
