function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateId() {
  return crypto.randomUUID();
}

// GET /api/book-note?book_id=xxx
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const bookId = url.searchParams.get('book_id');
  if (!bookId) return json({ error: 'book_id required' }, 400);

  const { results } = await env.DB.prepare(
    `SELECT * FROM book_notes WHERE book_id = ? ORDER BY datetime DESC`
  )
    .bind(bookId)
    .all();

  return json({ notes: results });
}

// POST /api/book-note
export async function onRequestPost({ request, env }) {
  const { book_id, text } = await request.json();
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
