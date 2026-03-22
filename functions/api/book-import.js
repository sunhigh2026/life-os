function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/book-import — Audible Library Extractor CSVをインポート（差し替え方式）
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

  // 既存Audibleデータを全削除（差し替え方式）
  const { results: existingRows } = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM books WHERE medium = 'Audible' OR medium = 'audible'`
  ).all();
  const deletedCount = existingRows[0]?.cnt || 0;
  await env.DB.prepare(
    `DELETE FROM books WHERE medium = 'Audible' OR medium = 'audible'`
  ).run();

  // 新規インポート用のISBNセット（重複チェック）
  const importedIsbns = new Set();

  let imported = 0;
  let skipped = 0;

  for (const row of records) {
    const title = row.Title || row.title || row['タイトル'] || '';
    const author = row.Authors || row.Author || row.author || row['著者'] || '';
    const isbn = row.ASIN || row.asin || row.isbn || row.ISBN || '';
    const coverUrl = row.Cover || row.cover_url || '';
    const myRating = row['My Rating'] || row.rating || '';
    const progress = row.Progress || '';
    const format = row.Format || '';
    const podcastParent = row['Podcast Parent'] || '';
    const length = row.Length || '';

    // Podcastはスキップ
    if (format === 'Podcast' || podcastParent === 'true') {
      skipped++;
      continue;
    }

    if (!title) { skipped++; continue; }

    // ASIN重複チェック（同一CSV内）
    if (isbn && importedIsbns.has(isbn)) {
      skipped++;
      continue;
    }

    // ステータス判定
    let status = 'wish';
    if (progress === '既読') {
      status = 'done';
    } else if (progress && /残り/.test(progress)) {
      status = 'reading';
    }

    // レーティング
    const rating = myRating ? parseInt(myRating, 10) || null : null;

    // ノートに再生時間を記録
    let note = null;
    if (length) {
      note = `全体: ${length}`;
    }

    const id = crypto.randomUUID();
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const datetime = jst.toISOString().slice(0, 16);

    try {
      await env.DB.prepare(
        `INSERT INTO books (id, datetime, isbn, title, author, cover_url, medium, status, rating, note)
         VALUES (?, ?, ?, ?, ?, ?, 'Audible', ?, ?, ?)`
      ).bind(
        id, datetime, isbn || null, title, author || null,
        coverUrl || null, status, rating, note
      ).run();

      if (isbn) importedIsbns.add(isbn);
      imported++;
    } catch {
      skipped++;
    }
  }

  return json({ imported, skipped, deleted: deletedCount, total: records.length });
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseRow(lines[0]);
  return lines.slice(1).map(line => {
    const cols = parseRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
    return obj;
  });
}

function parseRow(line) {
  const cols = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (ch === ',' && !inQuote) {
      cols.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cols.push(current.trim());
  return cols;
}
