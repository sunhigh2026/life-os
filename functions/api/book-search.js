function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/book-search?q=ISBN or title
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  if (!q) return json({ error: 'q parameter required' }, 400);

  const isIsbn = /^[0-9\-]{9,17}$/.test(q.replace(/\s/g, ''));

  if (isIsbn) {
    return searchByIsbn(q.replace(/[\-\s]/g, ''));
  } else {
    return searchByTitle(q);
  }
}

// ISBN検索: OpenBD（日本の書籍DB、無料・制限なし）
async function searchByIsbn(isbn) {
  try {
    const res = await fetch(`https://api.openbd.jp/v1/get?isbn=${isbn}`);
    const data = await res.json();
    if (data && data[0]) {
      const s = data[0].summary;
      return json({
        books: [{
          isbn: s.isbn || isbn,
          title: s.title || '',
          author: s.author || '',
          cover_url: s.cover || null,
          publisher: s.publisher || '',
          published_date: s.pubdate || '',
        }],
      });
    }
  } catch (_) {}
  // OpenBDにない場合はタイトル検索にフォールバック
  return searchByTitle(isbn);
}

// タイトル検索: Open Library（無料・APIキー不要・無制限）
async function searchByTitle(q) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10&lang=jpn`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LifeOS/1.0 (personal-app)' },
    });
    const data = await res.json();

    if (!data.docs || !data.docs.length) return json({ books: [] });

    const books = data.docs.map((doc) => {
      const isbn = (doc.isbn || [])[0] || null;
      const coverId = doc.cover_i;
      return {
        isbn,
        title: doc.title || '',
        author: (doc.author_name || []).join(', '),
        cover_url: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null,
        publisher: (doc.publisher || [])[0] || '',
        published_date: doc.first_publish_year ? String(doc.first_publish_year) : '',
      };
    });

    return json({ books });
  } catch (e) {
    return json({ error: 'book search failed', detail: e.message }, 502);
  }
}
