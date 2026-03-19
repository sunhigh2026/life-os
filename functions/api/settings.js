function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/settings?keys=char_name,char_system_prompt
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const keys = url.searchParams.get('keys');

  let results;
  if (keys) {
    const keyList = keys.split(',').map(k => k.trim());
    const placeholders = keyList.map(() => '?').join(',');
    results = (await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN (${placeholders})`
    ).bind(...keyList).all()).results;
  } else {
    results = (await env.DB.prepare(`SELECT key, value FROM settings`).all()).results;
  }

  const settings = {};
  results.forEach(r => { settings[r.key] = r.value; });
  return json(settings);
}

// PUT /api/settings  body: { "key": "...", "value": "..." }
export async function onRequestPut({ request, env }) {
  const { key, value } = await request.json();
  if (!key) return json({ error: 'key required' }, 400);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`
  ).bind(key, value).run();

  return json({ ok: true });
}
