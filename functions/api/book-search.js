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
    return searchByIsbn(q.replace(/[\-\s]/g, ''), env);
  } else {
    return searchByTitle(q, env);
  }
}

// ISBN検索: OpenBD（日本の書籍DB、無料・制限なし）
async function searchByIsbn(isbn, env) {
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
  } catch (e) {
    // OpenBDが失敗した場合はGoogle Booksにフォールバック
  }

  return searchByTitle(`isbn:${isbn}`, env);
}

// タイトル検索: Google Books API
async function searchByTitle(q, env) {
  try {
    const apiKey = env.GOOGLE_BOOKS_API_KEY ? `&key=${env.GOOGLE_BOOKS_API_KEY}` : '';
    const apiUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10${apiKey}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (!data.items) return json({ books: [], _debug: data.error?.message });

    const books = data.items.map((item) => {
      const info = item.volumeInfo;
      const isbn = (info.industryIdentifiers || [])
        .find((x) => x.type === 'ISBN_13' || x.type === 'ISBN_10')?.identifier || null;
      return {
        isbn,
        title: info.title || '',
        author: (info.authors || []).join(', '),
        cover_url: info.imageLinks?.thumbnail?.replace('http:', 'https:') || null,
        publisher: info.publisher || '',
        published_date: info.publishedDate || '',
      };
    });

    return json({ books });
  } catch (e) {
    return json({ error: 'book search failed', detail: e.message }, 502);
  }
}
