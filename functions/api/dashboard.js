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

  // ---- 日次概要カード用データ ----
  // 今日完了したToDo数
  const { cnt: todayDoneCount } = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM todos WHERE status = 'done' AND done_at LIKE ?`
  ).bind(`${today}%`).first() || { cnt: 0 };

  // 今日の日記エントリの平均mood
  const { avg_mood: todayAvgMood } = await env.DB.prepare(
    `SELECT AVG(mood) as avg_mood FROM entries WHERE datetime LIKE ? AND mood IS NOT NULL`
  ).bind(`${today}%`).first() || { avg_mood: null };

  // 連続記録日数（ストリークカウント）
  let streakCount = 0;
  for (let i = 0; i < streakData.length; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (streakData.find(s => s.date === key)) {
      streakCount++;
    } else {
      break;
    }
  }

  // 期限超過タスク数
  const overdueCount = openTodos.filter(t => t.due && t.due < today).length;

  // mustタスク数
  const mustCount = openTodos.filter(t => t.category === 'must').length;

  return json({
    today,
    todayEntries,
    openTodos,
    lookback,
    recentDone,
    streakData,
    summary: {
      openCount: openTodos.length,
      todayDoneCount,
      overdueCount,
      mustCount,
      todayAvgMood: todayAvgMood ? Math.round(todayAvgMood * 10) / 10 : null,
      streakCount,
    },
  });
}
