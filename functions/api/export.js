// GET /api/export?table=entries|todos|books&format=csv|json
const TABLE_QUERIES = {
  entries:    'SELECT * FROM entries    ORDER BY created_at DESC LIMIT ?',
  todos:      'SELECT * FROM todos      ORDER BY created_at DESC LIMIT ?',
  books:      'SELECT * FROM books      ORDER BY created_at DESC LIMIT ?',
  book_notes: 'SELECT * FROM book_notes ORDER BY created_at DESC LIMIT ?',
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const table = url.searchParams.get('table') || 'entries';
  const format = url.searchParams.get('format') || 'json';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10000') || 10000, 1), 10000);

  const query = TABLE_QUERIES[table];
  if (!query) {
    return new Response(JSON.stringify({ error: 'invalid table' }), { status: 400 });
  }

  const { results } = await env.DB.prepare(query).bind(limit).all();

  if (format === 'json') {
    return new Response(JSON.stringify({ table, count: results.length, data: results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // CSV
  if (!results.length) {
    return new Response('', { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
  }
  const headers = Object.keys(results[0]);
  const rows = results.map((row) =>
    headers.map((h) => {
      const v = row[h] == null ? '' : String(row[h]);
      return `"${v.replace(/"/g, '""')}"`;
    }).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\r\n');

  return new Response('\uFEFF' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${table}.csv"`,
    },
  });
}
