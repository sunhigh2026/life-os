// Gemini API 共通ユーティリティ
// モデル3段階:
//   "lite"  → gemini-1.5-flash（分類・提案など軽量構造化タスク）
//   "flash" → gemini-2.5-flash（通常チャット・タスク分解）
//   "pro"   → gemini-2.5-pro（週次レポート・深い分析）

const MODEL_MAP = {
  lite:  'gemini-1.5-flash',
  flash: 'gemini-2.5-flash',
  pro:   'gemini-2.5-pro',
};

/**
 * Gemini generateContent を呼び出す
 * @param {Object} opts
 * @param {string} opts.apiKey
 * @param {'lite'|'flash'|'pro'} opts.model
 * @param {Array} opts.contents  - Gemini contents配列
 * @param {Object} [opts.generationConfig]
 * @returns {Promise<string>} 応答テキスト（thought部分を除外済み）
 */
export async function callGemini({ apiKey, model = 'flash', contents, generationConfig = {} }) {
  const modelId = MODEL_MAP[model] || MODEL_MAP.flash;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig }),
    }
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const detail = errData.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini API error (${modelId}): ${detail}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];

  // thought パート（gemini-2.5系の思考プロセス）を除外して本文のみ返す
  const textParts = parts.filter(p => p.text !== undefined && p.thought !== true);
  const text = (textParts.length > 0 ? textParts : parts)
    .map(p => p.text || '')
    .join('');

  return text;
}

/**
 * Cloudflare Workers AI (bge-m3) でテキストをベクトル化（1024次元）
 * @param {Object} opts
 * @param {Object} opts.ai - Cloudflare AI binding (env.AI)
 * @param {string} opts.text - 埋め込むテキスト（5000文字以内に自動切り詰め）
 * @returns {Promise<number[]>} 1024次元の浮動小数点配列
 */
export async function getEmbedding({ ai, text }) {
  const truncated = text.slice(0, 5000);

  const result = await ai.run('@cf/baai/bge-m3', { text: [truncated] });
  return result?.data?.[0] || [];
}

/**
 * JSON応答からJSONを抽出するヘルパー
 * コードブロック(```json)やプレーンJSONに対応
 */
export function extractJson(text) {
  // ```json ... ``` ブロック
  const codeBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch (_) {}
  }
  // 最外側の { ... }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}
