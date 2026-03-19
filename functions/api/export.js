// GET /api/export?table=entries|todos|books&format=csv|json
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const table = url.searchParams.get('table') || 'entries';
  const format = url.searchParams.get('format') || 'json';
  const limit = parseInt(url.searchParams.get('limit') || '10000');

  const allowed = ['entries', 'todos', 'books', 'book_notes'];
  if (!allowed.includes(table)) {
    return new Response(JSON.stringify({ error: 'invalid table' }), { status: 400 });
  }

  const { results } = await env.DB.prepare(
    `SELECT * FROM ${table} ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all();

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
