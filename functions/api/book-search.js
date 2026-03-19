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

  // ISBNっぽければISBN検索、そうでなければタイトル検索
  const isIsbn = /^[0-9\-]{9,17}$/.test(q.replace(/\s/g, ''));
  const query = isIsbn ? `isbn:${q.replace(/[\-\s]/g, '')}` : q;

  try {
    const apiKey = env.GOOGLE_BOOKS_API_KEY ? `&key=${env.GOOGLE_BOOKS_API_KEY}` : '';
    const apiUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10${apiKey}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (!data.items) return json({ books: [] });

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
    return json({ error: 'Google Books API error', detail: e.message }, 502);
  }
}
