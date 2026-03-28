function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// GET /api/fitness?action=today|range|weekly|days
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const today = jstToday();

  // --- 今日のデータ ---
  if (action === 'today') {
    const row = await env.DB.prepare(
      `SELECT * FROM fitness WHERE date = ?`
    ).bind(today).first();
    return json({ today: row || null });
  }

  // --- 期間指定 ---
  if (action === 'range') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to) return json({ error: 'from and to required' }, 400);
    const { results } = await env.DB.prepare(
      `SELECT * FROM fitness WHERE date >= ? AND date <= ? ORDER BY date ASC`
    ).bind(from, to).all();
    return json({ fitness: results });
  }

  // --- 直近7日サマリー ---
  if (action === 'weekly') {
    const { results } = await env.DB.prepare(
      `SELECT * FROM fitness WHERE date >= date(?, '-6 days') ORDER BY date ASC`
    ).bind(today).all();

    const days = results.length;
    const avgSteps = days ? Math.round(results.reduce((s, r) => s + (r.steps || 0), 0) / days) : null;
    const avgActiveMin = days ? Math.round(results.reduce((s, r) => s + (r.active_minutes || 0), 0) / days) : null;
    const avgCalories = days ? Math.round(results.reduce((s, r) => s + (r.calories || 0), 0) / days) : null;
    const sleepDays = results.filter(r => r.sleep_minutes);
    const avgSleep = sleepDays.length ? Math.round(sleepDays.reduce((s, r) => s + r.sleep_minutes, 0) / sleepDays.length) : null;
    const weightEntries = results.filter(r => r.weight);
    const latestWeight = weightEntries.length ? weightEntries[weightEntries.length - 1].weight : null;

    return json({
      fitness: results,
      summary: { avgSteps, avgActiveMin, avgCalories, avgSleep, latestWeight, days },
    });
  }

  // --- デフォルト: 直近N日 (後方互換) ---
  const days = parseInt(url.searchParams.get('days') || '30', 10);
  const { results } = await env.DB.prepare(
    `SELECT * FROM fitness WHERE date >= date(?, '-' || ? || ' days') ORDER BY date DESC`
  ).bind(today, days).all();

  const todayData = results.find(r => r.date === today) || null;
  return json({ fitness: results, today: todayData });
}

// POST /api/fitness — 単日データ登録/更新
export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { date, steps, active_minutes, weight, calories, sleep_minutes } = body;

  if (!date) return json({ error: 'date required' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO fitness (id, date, steps, active_minutes, calories, weight, sleep_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       steps = COALESCE(excluded.steps, fitness.steps),
       active_minutes = COALESCE(excluded.active_minutes, fitness.active_minutes),
       calories = COALESCE(excluded.calories, fitness.calories),
       weight = COALESCE(excluded.weight, fitness.weight),
       sleep_minutes = COALESCE(excluded.sleep_minutes, fitness.sleep_minutes)`
  ).bind(id, date, steps ?? null, active_minutes ?? null, calories ?? null, weight ?? null, sleep_minutes ?? null).run();

  return json({ id, date, steps, active_minutes, calories, weight, sleep_minutes }, 201);
}
