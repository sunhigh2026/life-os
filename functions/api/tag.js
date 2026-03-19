function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/tag?q=xxx
// entries と todos からタグの使用頻度を集計
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';

  const filter = q ? `WHERE tag LIKE ?` : `WHERE tag IS NOT NULL AND tag != ''`;
  const bind = q ? [`%${q}%`] : [];

  const query = `
    SELECT tag, COUNT(*) as count FROM (
      SELECT tag FROM entries ${filter}
      UNION ALL
      SELECT tag FROM todos ${filter}
    )
    WHERE tag IS NOT NULL AND tag != ''
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 20
  `;

  const stmt = env.DB.prepare(query);
  const { results } = bind.length > 0
    ? await stmt.bind(...bind, ...bind).all()
    : await stmt.all();

  return json({ tags: results });
}
