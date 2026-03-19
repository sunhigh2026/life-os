function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateId() {
  return crypto.randomUUID();
}

// GET /api/book?limit=10
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const bookId = url.searchParams.get('book_id');

  // book-note の取得
  if (url.pathname.endsWith('/book-note')) {
    if (!bookId) return json({ error: 'book_id required' }, 400);
    const { results } = await env.DB.prepare(
      `SELECT * FROM book_notes WHERE book_id = ? ORDER BY datetime DESC`
    )
      .bind(bookId)
      .all();
    return json({ notes: results });
  }

  const status = url.searchParams.get('status'); // want / reading / done / null=all
  const query = status && status !== 'all'
    ? `SELECT * FROM books WHERE status = ? ORDER BY datetime DESC LIMIT ?`
    : `SELECT * FROM books ORDER BY datetime DESC LIMIT ?`;
  const binds = status && status !== 'all' ? [status, limit] : [limit];

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return json({ books: results });
}

// POST /api/book
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const body = await request.json();

  // book-note の保存
  if (url.pathname.endsWith('/book-note')) {
    const { book_id, text } = body;
    if (!book_id || !text) return json({ error: 'book_id and text required' }, 400);
    const id = generateId();
    const datetime = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO book_notes (id, datetime, book_id, text) VALUES (?, ?, ?, ?)`
    )
      .bind(id, datetime, book_id, text)
      .run();
    return json({ id, datetime, book_id, text }, 201);
  }

  const { isbn, title, author, cover_url, medium, rating, status, note } = body;
  const id = generateId();
  const datetime = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO books (id, datetime, isbn, title, author, cover_url, medium, rating, status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, datetime, isbn ?? null, title ?? null, author ?? null, cover_url ?? null,
          medium ?? null, rating ?? null, status ?? 'done', note ?? null)
    .run();

  return json({ id, datetime, isbn, title, author, cover_url, medium, rating, status, note }, 201);
}

// PUT /api/book
export async function onRequestPut({ request, env }) {
  const body = await request.json();
  const { id, status, rating, note, medium } = body;

  if (!id) return json({ error: 'id required' }, 400);

  const updates = [];
  const values = [];

  if (status !== undefined) { updates.push('status = ?'); values.push(status); }
  if (rating !== undefined) { updates.push('rating = ?'); values.push(rating); }
  if (note   !== undefined) { updates.push('note = ?');   values.push(note); }
  if (medium !== undefined) { updates.push('medium = ?'); values.push(medium); }

  if (updates.length === 0) return json({ error: 'no fields to update' }, 400);

  values.push(id);
  await env.DB.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return json({ id, updated: true });
}

// DELETE /api/book?id=xxx
export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);

  await env.DB.prepare(`DELETE FROM books WHERE id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM book_notes WHERE book_id = ?`).bind(id).run();
  return json({ id, deleted: true });
}
