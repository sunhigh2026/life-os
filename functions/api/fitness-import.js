function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/fitness-import — CSV/JSONインポート
export async function onRequestPost({ request, env }) {
  const contentType = request.headers.get('Content-Type') || '';
  let records = [];

  if (contentType.includes('application/json')) {
    const body = await request.json();
    records = body.data || body;
  } else if (contentType.includes('text/csv') || contentType.includes('multipart/form-data')) {
    // CSV テキストを直接受け取る
    let csvText = '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (file) csvText = await file.text();
    } else {
      csvText = await request.text();
    }
    records = parseCsv(csvText);
  } else {
    // テキストとしてJSONを試す
    const text = await request.text();
    try {
      const body = JSON.parse(text);
      records = body.data || body;
    } catch {
      records = parseCsv(text);
    }
  }

  if (!Array.isArray(records) || !records.length) {
    return json({ error: 'No records found', hint: 'JSON: {"data":[{"date":"2024-01-01","steps":8000,"active_minutes":30}]}  CSV: date,steps,active_minutes header' }, 400);
  }

  let imported = 0;
  let skipped = 0;

  for (const row of records) {
    const date = row.date || row.Date || row['日付'];
    const steps = parseInt(row.steps || row.Steps || row['歩数'] || '0', 10) || null;
    const active = parseInt(row.active_minutes || row.ActiveMinutes || row['運動時間'] || '0', 10) || null;

    if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      skipped++;
      continue;
    }

    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO fitness (id, date, steps, active_minutes)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
           steps = COALESCE(excluded.steps, fitness.steps),
           active_minutes = COALESCE(excluded.active_minutes, fitness.active_minutes)`
      ).bind(id, date, steps, active).run();
      imported++;
    } catch {
      skipped++;
    }
  }

  return json({ imported, skipped, total: records.length });
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
    return obj;
  });
}
