function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/dashboard
export async function onRequestGet({ env }) {
  // JST (UTC+9) で今日の日付を計算
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = jst.toISOString().slice(0, 10); // YYYY-MM-DD (JST)

  // 今日の記録
  const { results: todayEntries } = await env.DB.prepare(
    `SELECT * FROM entries WHERE datetime LIKE ? ORDER BY datetime DESC`
  )
    .bind(`${today}%`)
    .all();

  // 未完了ToDo
  const { results: openTodos } = await env.DB.prepare(
    `SELECT * FROM todos WHERE status = 'open' ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'mid' THEN 1 ELSE 2 END,
      CASE WHEN due IS NULL THEN 1 ELSE 0 END,
      due ASC, created_at DESC
    LIMIT 30`
  ).all();

  // 同月日の振り返り（過去の今日）
  const monthDay = today.slice(5); // MM-DD
  const { results: lookback } = await env.DB.prepare(
    `SELECT * FROM entries
     WHERE datetime LIKE ? AND datetime NOT LIKE ?
     ORDER BY datetime DESC LIMIT 5`
  )
    .bind(`%-${monthDay}%`, `${today}%`)
    .all();

  // 最近の完了ToDo（直近5件）
  const { results: recentDone } = await env.DB.prepare(
    `SELECT * FROM todos WHERE status = 'done' ORDER BY done_at DESC LIMIT 5`
  ).all();

  // 30日ストリーク（日ごとのエントリ件数）
  const { results: streakData } = await env.DB.prepare(
    `SELECT substr(datetime, 1, 10) as date, COUNT(*) as count
     FROM entries
     WHERE datetime >= date('now', '-29 days')
     GROUP BY date
     ORDER BY date ASC`
  ).all();

  return json({
    today,
    todayEntries,
    openTodos,
    lookback,
    recentDone,
    streakData,
  });
}
