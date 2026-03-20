function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/book-import — Audible Library Extractor CSVをインポート
export async function onRequestPost({ request, env }) {
  const contentType = request.headers.get('Content-Type') || '';
  let records = [];

  if (contentType.includes('application/json')) {
    const body = await request.json();
    records = body.data || body;
  } else {
    // CSV / multipart
    let csvText = '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (file) csvText = await file.text();
    } else {
      csvText = await request.text();
    }
    records = parseCsv(csvText);
  }

  if (!Array.isArray(records) || !records.length) {
    return json({ error: 'No records found' }, 400);
  }

  // 既存ISBNを取得（重複スキップ用）
  const { results: existing } = await env.DB.prepare(
    `SELECT isbn FROM books WHERE isbn IS NOT NULL AND isbn != ''`
  ).all();
  const existingIsbns = new Set(existing.map(r => r.isbn));

  let imported = 0;
  let skipped = 0;

  for (const row of records) {
    // Audible Library Extractor の主要カラム名に対応
    const title = row.title || row.Title || row['タイトル'] || '';
    const author = row.author || row.Author || row.authors || row['著者'] || '';
    const isbn = row.isbn || row.ISBN || row.asin || row.ASIN || '';
    const medium = row.medium || 'audible'; // デフォルトAudible

    if (!title) { skipped++; continue; }

    // ISBN/ASIN重複チェック
    if (isbn && existingIsbns.has(isbn)) {
      skipped++;
      continue;
    }

    const id = crypto.randomUUID();
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const datetime = jst.toISOString().slice(0, 16);

    try {
      await env.DB.prepare(
        `INSERT INTO books (id, datetime, isbn, title, author, medium, status, rating)
         VALUES (?, ?, ?, ?, ?, ?, 'done', NULL)`
      ).bind(id, datetime, isbn || null, title, author || null, medium).run();

      if (isbn) existingIsbns.add(isbn);
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
    // CSVパース（ダブルクォート内のカンマ対応）
    const cols = [];
    let current = '';
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { cols.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cols.push(current.trim());

    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
    return obj;
  });
}
