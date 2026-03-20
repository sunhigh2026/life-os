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

  // JST で今日を計算
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = jst.toISOString().slice(0, 10);

  const { results } = await env.DB.prepare(
    `SELECT * FROM fitness WHERE date >= date(?, '-' || ? || ' days') ORDER BY date DESC`
  ).bind(today, days).all();

  const todayData = results.find(r => r.date === today) || null;

  return json({ fitness: results, today: todayData });
}

// POST /api/fitness — 単日データ登録/更新
export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { date, steps, active_minutes, weight } = body;

  if (!date) return json({ error: 'date required' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO fitness (id, date, steps, active_minutes, weight)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       steps = COALESCE(excluded.steps, fitness.steps),
       active_minutes = COALESCE(excluded.active_minutes, fitness.active_minutes),
       weight = COALESCE(excluded.weight, fitness.weight)`
  ).bind(id, date, steps ?? null, active_minutes ?? null, weight ?? null).run();

  return json({ id, date, steps, active_minutes, weight }, 201);
}
