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
  return searchByTitle(isbn);
}

// タイトル検索: 国立国会図書館 SRU API（無料・APIキー不要・無制限）
async function searchByTitle(q) {
  try {
    // CQLクエリ: title OR creator でフルテキスト検索、図書に限定
    const cql = `(title="${q}" OR creator="${q}") AND mediatype="1"`;
    const ndlUrl = `https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&query=${encodeURIComponent(cql)}&maximumRecords=10&recordSchema=dcndl`;

    const res = await fetch(ndlUrl, {
      headers: { 'User-Agent': 'LifeOS/1.0 (personal-app)' },
    });
    if (!res.ok) throw new Error(`NDL HTTP ${res.status}`);

    const xml = await res.text();
    const books = parseNdlXml(xml);

    if (books.length > 0) {
      return json({ books });
    }

    // NDL で見つからない場合は Open Library にフォールバック
    return searchOpenLibrary(q);
  } catch (e) {
    return json({ error: 'book search failed', detail: e.message }, 502);
  }
}

// NDL XML パーサー（シンプルな正規表現ベース）
function parseNdlXml(xml) {
  const books = [];

  // <record>...</record> を個別に処理
  const recordRegex = /<record\b[^>]*>[\s\S]*?<\/record>/g;
  let match;

  while ((match = recordRegex.exec(xml)) !== null) {
    const rec = match[0];

    // タイトル: dc:title / dcterms:title
    const title =
      tagContent(rec, 'dc:title') ||
      tagContent(rec, 'dcterms:title') ||
      '';
    if (!title) continue;

    // 著者: dc:creator / dcterms:creator 内の foaf:name
    const creatorBlock = tagBlock(rec, 'dcterms:creator') || '';
    const author =
      tagContent(creatorBlock, 'foaf:name') ||
      tagContent(rec, 'dc:creator') ||
      '';

    // 出版社: dc:publisher / dcterms:publisher 内の foaf:name
    const pubBlock = tagBlock(rec, 'dcterms:publisher') || '';
    const publisher =
      tagContent(pubBlock, 'foaf:name') ||
      tagContent(rec, 'dc:publisher') ||
      '';

    // 出版年
    const published_date =
      tagContent(rec, 'dcterms:date') ||
      tagContent(rec, 'dc:date') ||
      '';

    // ISBN: dc:identifier か属性値に含まれる 978/979 始まりの数字列
    let isbn = null;
    const isbnMatches = [...rec.matchAll(/(?:isbn[:\s]*)?(?:978|979)[-\d]{10,13}/gi)];
    if (isbnMatches.length) {
      isbn = isbnMatches[0][0].replace(/[^0-9X]/gi, '');
    }

    // ISBN があれば OpenBD でカバー画像を補完（非同期は避けて null でOK）
    books.push({
      isbn,
      title: decodeXmlEntities(title),
      author: decodeXmlEntities(author),
      publisher: decodeXmlEntities(publisher),
      published_date: published_date.slice(0, 4),
      cover_url: isbn ? `https://cover.openbd.jp/${isbn}.jpg` : null,
    });
  }

  return books;
}

// タグの内容を取得
function tagContent(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

// タグのブロック全体を取得（ネストあり）
function tagBlock(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i'));
  return m ? m[0] : null;
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
