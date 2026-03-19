function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/fitness?days=30
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '30', 10);

  const { results } = await env.DB.prepare(
    `SELECT * FROM fitness WHERE date >= date('now', '-' || ? || ' days') ORDER BY date DESC`
  ).bind(days).all();

  // 今日のデータ
  const today = new Date().toISOString().slice(0, 10);
  const todayData = results.find(r => r.date === today) || null;

  return json({ fitness: results, today: todayData });
}

// POST /api/fitness/import は別ファイル fitness-import.js で対応
// POST /api/fitness — 単日データ手動登録
export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { date, steps, active_minutes } = body;

  if (!date) return json({ error: 'date required' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO fitness (id, date, steps, active_minutes)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       steps = COALESCE(excluded.steps, fitness.steps),
       active_minutes = COALESCE(excluded.active_minutes, fitness.active_minutes)`
  ).bind(id, date, steps ?? null, active_minutes ?? null).run();

  return json({ id, date, steps, active_minutes }, 201);
}
