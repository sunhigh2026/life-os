function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateId() {
  return crypto.randomUUID();
}

// GET /api/entry?date=YYYY-MM-DD  または  ?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limit = parseInt(url.searchParams.get('limit') || '100');

  let results;
  if (date) {
    ({ results } = await env.DB.prepare(
      `SELECT * FROM entries WHERE datetime LIKE ? ORDER BY datetime DESC`
    ).bind(`${date}%`).all());
  } else if (from || to) {
    const f = from || '2000-01-01';
    const t = to || '2099-12-31';
    ({ results } = await env.DB.prepare(
      `SELECT * FROM entries WHERE datetime >= ? AND datetime <= ? ORDER BY datetime DESC LIMIT ?`
    ).bind(f, t + 'T23:59:59', limit).all());
  } else {
    ({ results } = await env.DB.prepare(
      `SELECT * FROM entries ORDER BY datetime DESC LIMIT ?`
    ).bind(limit).all());
  }

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

  // エンベディング（失敗してもメイン処理に影響しない）
  if (text && text.trim()) {
    try {
      const { embedAndStore } = await import('./_vectorize.js');
      await embedAndStore({
        env,
        sourceType: 'entry',
        sourceId: id,
        text: `${datetime} ${tag ? `[${tag}]` : ''} ${text}`,
        metadata: { date: datetime.slice(0, 10) },
      });
    } catch (_) {}
  }

  return json({ id, datetime, mood, tag, text }, 201);
}

// PUT /api/entry — 編集
export async function onRequestPut({ request, env }) {
  const body = await request.json();
  const { id, datetime, mood, tag, text } = body;
  if (!id) return json({ error: 'id required' }, 400);

  const updates = [];
  const values = [];
  if (datetime !== undefined) { updates.push('datetime = ?'); values.push(datetime); }
  if (mood !== undefined)     { updates.push('mood = ?');     values.push(mood); }
  if (tag !== undefined)      { updates.push('tag = ?');      values.push(tag); }
  if (text !== undefined)     { updates.push('text = ?');     values.push(text); }

  if (updates.length === 0) return json({ error: 'no fields to update' }, 400);

  values.push(id);
  await env.DB.prepare(`UPDATE entries SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values).run();

  // テキストが更新された場合はエンベディングを再生成
  if (text !== undefined && text.trim()) {
    try {
      const { embedAndStore } = await import('./_vectorize.js');
      const dtVal = datetime || '';
      const tagVal = tag || '';
      await embedAndStore({
        env,
        sourceType: 'entry',
        sourceId: id,
        text: `${dtVal} ${tagVal ? `[${tagVal}]` : ''} ${text}`.trim(),
        metadata: { date: (dtVal || '').slice(0, 10) },
      });
    } catch (_) {}
  }

  return json({ id, updated: true });
}

// DELETE /api/entry?id=xxx
export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);

  await env.DB.prepare(`DELETE FROM entries WHERE id = ?`).bind(id).run();

  // Vectorize からも削除
  try {
    const { deleteVector } = await import('./_vectorize.js');
    await deleteVector({ env, sourceType: 'entry', sourceId: id });
  } catch (_) {}

  return json({ id, deleted: true });
}
