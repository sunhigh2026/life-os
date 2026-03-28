function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/book-search?q=ISBN or title
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  if (!q) return json({ error: 'q parameter required' }, 400);

  const cleaned = q.replace(/[\-\s]/g, '');
  const isIsbn13 = /^(978|979)\d{10}$/.test(cleaned);
  const isIsbn10 = /^\d{9}[\dXx]$/.test(cleaned);
  const isIsbn = isIsbn13 || isIsbn10;
  // 書籍JANコード2段目（192:書籍価格, 191:雑誌）や、ISBN以外の13桁バーコード全般を検出
  const is13Digits = /^\d{13}$/.test(cleaned);
  const isNonIsbnBarcode = is13Digits && !isIsbn13;

  if (isNonIsbnBarcode) {
    // 書籍JANコード2段目（価格コード）→ 上のバーコードを案内
    return json({
      books: [],
      hint: 'これはISBNバーコードではないみたい📖 上のバーコード（978で始まる方）を読み取ってね！',
    });
  }

  if (isIsbn) {
    return searchByIsbn(cleaned);
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
          cover_url: s.cover || (s.isbn ? `https://books.google.com/books/content?vid=isbn:${s.isbn}&printsec=frontcover&img=1&zoom=1` : null),
          publisher: s.publisher || '',
          published_date: s.pubdate || '',
        }],
      });
    }
  } catch (_) {}
  return searchByTitle(isbn);
}

// 検索クエリを正規化: 全角スペース→半角、助詞→スペースでキーワード分割
function normalizeQuery(q) {
  return q
    .replace(/\u3000/g, ' ')           // 全角スペース → 半角
    .replace(/[はがのをにでと]/g, ' ')   // 助詞をスペースに
    .replace(/\s+/g, ' ')              // 連続スペースを1つに
    .trim();
}

// タイトル検索: 国立国会図書館 OpenSearch API（無料・APIキー不要・無制限）
async function searchByTitle(q) {
  try {
    const normalized = normalizeQuery(q);
    // OpenSearch (RSS): title= でタイトル検索、dpid=iss-ndl-opac で図書に限定
    const ndlUrl = `https://ndlsearch.ndl.go.jp/api/opensearch?title=${encodeURIComponent(normalized)}&cnt=10&dpid=iss-ndl-opac`;

    const res = await fetch(ndlUrl, {
      headers: { 'User-Agent': 'LifeOS/1.0 (personal-app)' },
    });
    if (!res.ok) throw new Error(`NDL HTTP ${res.status}`);

    const xml = await res.text();
    const books = parseNdlRss(xml);

    if (books.length > 0) {
      return json({ books });
    }

    // NDL で見つからない場合は Open Library にフォールバック
    return searchOpenLibrary(q);
  } catch (e) {
    return json({ error: 'book search failed', detail: e.message }, 502);
  }
}

// NDL OpenSearch RSS パーサー
function parseNdlRss(xml) {
  const books = [];

  // <item>...</item> を個別に処理
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];

    // タイトル（"書名 / 著者名" 形式の場合は書名だけ取り出す）
    const rawTitle = tagContent(item, 'title') || '';
    const title = decodeXmlEntities(rawTitle.split('/')[0].trim());
    if (!title) continue;

    // 著者
    const author = decodeXmlEntities(tagContent(item, 'dc:creator') || '');

    // 出版社
    const publisher = decodeXmlEntities(tagContent(item, 'dc:publisher') || '');

    // 出版年
    const published_date = (tagContent(item, 'dc:date') || '').slice(0, 4);

    // ISBN: 978/979 始まりの連続数字
    let isbn = null;
    const isbnMatch = item.match(/(?:978|979)\d{10}/);
    if (isbnMatch) {
      isbn = isbnMatch[0];
    }

    books.push({
      isbn,
      title,
      author,
      publisher,
      published_date,
      cover_url: isbn ? `https://books.google.com/books/content?vid=isbn:${isbn}&printsec=frontcover&img=1&zoom=1` : null,
    });
  }

  return books;
}

// タグの内容を取得
function tagContent(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

// XML エンティティのデコード
function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Open Library フォールバック（英語圏の書籍に強い）
async function searchOpenLibrary(q) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10`;
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
    return json({ books: [], _error: e.message });
  }
}
