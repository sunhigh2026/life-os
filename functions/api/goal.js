function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function getCurrentPeriod(freq) {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const today = `${y}-${m}-${d}`;

  if (freq === 'daily') {
    return { start: today, end: today };
  }
  if (freq === 'weekly') {
    const day = jst.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(jst);
    monday.setUTCDate(monday.getUTCDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const fmt = (dt) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    return { start: fmt(monday), end: fmt(sunday) };
  }
  if (freq === 'monthly') {
    return { start: `${y}-${m}-01`, end: `${y}-${m}-31` };
  }
  if (freq === 'yearly') {
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  // 'once' — use goal start/deadline directly
  return null;
}

async function computeProgress(db, goal) {
  let period = getCurrentPeriod(goal.freq);
  if (!period && goal.freq === 'once') {
    // For one-time goals, use goal's own start/deadline
    if (goal.start && goal.deadline) {
      period = { start: goal.start, end: goal.deadline };
    } else {
      return { current: 0, progress: 0 };
    }
  }
  if (!period) return { current: 0, progress: 0 };

  let current = 0;

  if (goal.unit === '冊') {
    // Count books read in the period
    const row = await db.prepare(
      `SELECT COUNT(*) as cnt FROM books WHERE status = 'done' AND datetime BETWEEN ? AND ?`
    ).bind(period.start, period.end + 'T23:59:59').first();
    current = row?.cnt || 0;
  } else if (goal.unit === '歩') {
    const row = await db.prepare(
      `SELECT AVG(steps) as avg_steps FROM fitness WHERE date BETWEEN ? AND ?`
    ).bind(period.start, period.end).first();
    current = Math.round(row?.avg_steps || 0);
  } else if (goal.unit === '回') {
    const row = await db.prepare(
      `SELECT COUNT(*) as cnt FROM entries WHERE datetime BETWEEN ? AND ?`
    ).bind(period.start, period.end + 'T23:59:59').first();
    current = row?.cnt || 0;
  } else if (goal.unit === '分') {
    const row = await db.prepare(
      `SELECT AVG(active_minutes) as v FROM fitness WHERE date BETWEEN ? AND ?`
    ).bind(period.start, period.end).first();
    current = Math.round(row?.v || 0);
  } else if (goal.unit === 'kg') {
    const row = await db.prepare(
      `SELECT weight FROM fitness WHERE weight IS NOT NULL ORDER BY date DESC LIMIT 1`
    ).first();
    current = row?.weight || 0;
  } else {
    return { current: 0, progress: 0 };
  }

  const target = goal.target || 1;
  const progress = Math.min(100, Math.round((current / target) * 100));
  return { current, progress };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const db = env.DB;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');

  try {
    let query = 'SELECT * FROM goals';
    const bindings = [];
    if (status) {
      query += ' WHERE status = ?';
      bindings.push(status);
    }
    query += ' ORDER BY created_at DESC';

    const stmt = bindings.length > 0 ? db.prepare(query).bind(...bindings) : db.prepare(query);
    const { results } = await stmt.all();

    // Compute progress for each active goal
    const goalsWithProgress = await Promise.all(
      results.map(async (goal) => {
        try {
          if (goal.status === 'active' && goal.target && goal.freq) {
            const { current, progress } = await computeProgress(db, goal);
            return { ...goal, current, progress };
          }
        } catch (_) {}
        return { ...goal, current: null, progress: null };
      })
    );

    return json({ ok: true, goals: goalsWithProgress });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const db = env.DB;

  try {
    const body = await request.json();
    const id = crypto.randomUUID();
    const { type, goal, target, unit, freq, start, deadline, status, memo } = body;

    await db.prepare(
      `INSERT INTO goals (id, type, goal, target, unit, freq, start, deadline, memo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      type || 'habit',
      goal || '',
      target ?? null,
      unit || null,
      freq || null,
      start || null,
      deadline || null,
      memo || null,
      status || 'active'
    ).run();

    return json({ ok: true, id }, 201);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { env, request } = context;
  const db = env.DB;

  try {
    const body = await request.json();
    const { id, ...fields } = body;
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const allowed = ['type', 'goal', 'target', 'unit', 'freq', 'start', 'deadline', 'memo', 'status'];
    const setClauses = [];
    const values = [];

    for (const key of allowed) {
      if (key in fields) {
        setClauses.push(`${key} = ?`);
        values.push(fields[key]);
      }
    }

    if (setClauses.length === 0) {
      return json({ ok: false, error: 'No fields to update' }, 400);
    }

    values.push(id);
    await db.prepare(
      `UPDATE goals SET ${setClauses.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const db = env.DB;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) return json({ ok: false, error: 'id is required' }, 400);

  try {
    await db.prepare('DELETE FROM goals WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
