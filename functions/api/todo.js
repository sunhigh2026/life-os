function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateId() {
  return crypto.randomUUID();
}

// GET /api/todo?status=open
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'open';

  let query, bindings;
  if (status === 'all') {
    query = `SELECT * FROM todos ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'mid' THEN 1 ELSE 2 END,
      CASE WHEN due IS NULL THEN 1 ELSE 0 END,
      due ASC, created_at DESC`;
    bindings = [];
  } else {
    query = `SELECT * FROM todos WHERE status = ? ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'mid' THEN 1 ELSE 2 END,
      CASE WHEN due IS NULL THEN 1 ELSE 0 END,
      due ASC, created_at DESC`;
    bindings = [status];
  }

  const stmt = env.DB.prepare(query);
  const { results } = bindings.length > 0 ? await stmt.bind(...bindings).all() : await stmt.all();

  return json({ todos: results });
}

// POST /api/todo
export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { datetime, text, tag, priority, due, category, parent_id, start_date } = body;

  if (!datetime || !text) {
    return json({ error: 'datetime and text required' }, 400);
  }

  const id = generateId();
  await env.DB.prepare(
    `INSERT INTO todos (id, datetime, text, tag, priority, due, category, parent_id, start_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`
  )
    .bind(id, datetime, text, tag ?? null, priority ?? 'mid', due ?? null, category ?? null, parent_id ?? null, start_date ?? null)
    .run();

  return json({ id, datetime, text, tag, priority, due, category, parent_id: parent_id ?? null, start_date: start_date ?? null, status: 'open' }, 201);
}

// PUT /api/todo — ステータス更新・期限変更・優先度変更
export async function onRequestPut({ request, env }) {
  const body = await request.json();
  const { id, status, due, priority, text, tag, category, start_date } = body;

  if (!id) {
    return json({ error: 'id required' }, 400);
  }

  const updates = [];
  const values = [];

  if (status !== undefined) {
    updates.push('status = ?');
    values.push(status);
    if (status === 'done') {
      updates.push('done_at = ?');
      values.push(new Date().toISOString());
    } else {
      updates.push('done_at = NULL');
    }
  }
  if (due !== undefined) {
    updates.push('due = ?');
    values.push(due);
  }
  if (priority !== undefined) {
    updates.push('priority = ?');
    values.push(priority);
  }
  if (text !== undefined) {
    updates.push('text = ?');
    values.push(text);
  }
  if (tag !== undefined) {
    updates.push('tag = ?');
    values.push(tag);
  }
  if (category !== undefined) {
    updates.push('category = ?');
    values.push(category);
  }
  if (start_date !== undefined) {
    updates.push('start_date = ?');
    values.push(start_date);
  }

  if (updates.length === 0) {
    return json({ error: 'no fields to update' }, 400);
  }

  values.push(id);
  await env.DB.prepare(
    `UPDATE todos SET ${updates.join(', ')} WHERE id = ?`
  )
    .bind(...values)
    .run();

  // 親タスクを完了したらサブタスクも全て完了にする
  if (status === 'done') {
    await env.DB.prepare(
      `UPDATE todos SET status = 'done', done_at = ? WHERE parent_id = ? AND status = 'open'`
    ).bind(new Date().toISOString(), id).run();
  }

  return json({ id, updated: true });
}

// DELETE /api/todo?id=xxx
export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);

  // サブタスクも一緒に削除（カスケード）
  await env.DB.prepare(`DELETE FROM todos WHERE parent_id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM todos WHERE id = ?`).bind(id).run();
  return json({ id, deleted: true });
}
