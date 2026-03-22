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
  const medium = url.searchParams.get('medium'); // owned / library / kindle / audible / other
  const sort = url.searchParams.get('sort') || 'datetime_desc'; // datetime_desc / datetime_asc / end_date / title
  const search = url.searchParams.get('search');

  const conditions = [];
  const binds = [];

  if (status && status !== 'all') {
    conditions.push('status = ?');
    binds.push(status);
  }
  if (medium && medium !== 'all') {
    conditions.push('(medium = ? OR LOWER(medium) = LOWER(?))');
    binds.push(medium, medium);
  }
  if (search) {
    conditions.push('(title LIKE ? OR author LIKE ? OR note LIKE ?)');
    const like = `%${search}%`;
    binds.push(like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderMap = {
    datetime_desc: 'datetime DESC',
    datetime_asc: 'datetime ASC',
    end_date: 'end_date DESC, datetime DESC',
    title: 'title COLLATE NOCASE ASC',
  };
  const order = orderMap[sort] || 'datetime DESC';

  binds.push(limit);
  const query = `SELECT * FROM books ${where} ORDER BY ${order} LIMIT ?`;
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

  const { isbn, title, author, cover_url, medium, rating, status, note, tag, end_date } = body;
  const id = generateId();
  const datetime = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO books (id, datetime, isbn, title, author, cover_url, medium, rating, status, note, tag, end_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, datetime, isbn ?? null, title ?? null, author ?? null, cover_url ?? null,
          medium ?? null, rating ?? null, status ?? 'done', note ?? null, tag ?? null, end_date ?? null)
    .run();

  return json({ id, datetime, isbn, title, author, cover_url, medium, rating, status, note, tag, end_date }, 201);
}

// PUT /api/book
export async function onRequestPut({ request, env }) {
  const body = await request.json();
  const { id, status, rating, note, medium, tag, end_date } = body;

  if (!id) return json({ error: 'id required' }, 400);

  const updates = [];
  const values = [];

  if (status !== undefined)   { updates.push('status = ?');   values.push(status); }
  if (rating !== undefined)   { updates.push('rating = ?');   values.push(rating); }
  if (note   !== undefined)   { updates.push('note = ?');     values.push(note); }
  if (medium !== undefined)   { updates.push('medium = ?');   values.push(medium); }
  if (tag    !== undefined)   { updates.push('tag = ?');      values.push(tag); }
  if (end_date !== undefined) { updates.push('end_date = ?'); values.push(end_date); }

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
