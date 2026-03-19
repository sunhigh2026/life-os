function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateId() {
  return crypto.randomUUID();
}

// GET /api/entry?date=YYYY-MM-DD
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date');

  if (!date) {
    return json({ error: 'date parameter required' }, 400);
  }

  const { results } = await env.DB.prepare(
    `SELECT * FROM entries WHERE datetime LIKE ? ORDER BY datetime DESC`
  )
    .bind(`${date}%`)
    .all();

  return json({ entries: results });
}

// POST /api/entry
export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { datetime, mood, tag, text } = body;

  if (!datetime) {
    return json({ error: 'datetime required' }, 400);
  }

  const id = generateId();
  await env.DB.prepare(
    `INSERT INTO entries (id, datetime, mood, tag, text) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, datetime, mood ?? null, tag ?? null, text ?? null)
    .run();

  return json({ id, datetime, mood, tag, text }, 201);
}
