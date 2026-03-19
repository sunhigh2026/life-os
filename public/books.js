// ==============================
// 設定
// ==============================
const AUTH_KEY = '<YOUR_AUTH_KEY>';

// ==============================
// 状態
// ==============================
let selectedBook = null;
let selectedMedium = 'book';
let selectedStatus = 'done';
let selectedRating = 0;
let html5Qr = null;
let noteRecognition = null;
let isNoteRecording = false;

// ==============================
// 初期化
// ==============================
document.addEventListener('DOMContentLoaded', () => {
  loadRecentBooks();
});

// ==============================
// API ユーティリティ
// ==============================
async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_KEY}`,
    ...(options.headers || {}),
  };
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ==============================
// 書籍検索
// ==============================
async function searchBooks() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) { showToast('検索キーワードを入力してください'); return; }

  try {
    const data = await apiFetch(`/api/book-search?q=${encodeURIComponent(q)}`);
    renderSearchResults(data.books);
  } catch (e) {
    showToast(`検索エラー: ${e.message}`);
  }
}

function renderSearchResults(books) {
  const el = document.getElementById('searchResults');
  document.getElementById('registerArea').style.display = 'none';
  el.style.display = '';

  if (!books.length) {
    el.innerHTML = '<div class="empty-msg">書籍が見つかりませんでした</div>';
    return;
  }

  el.innerHTML = books.map((b, i) => `
    <div class="book-card" onclick="selectBook(${i})">
      ${b.cover_url
        ? `<img class="book-cover" src="${b.cover_url}" alt="">`
        : `<div class="book-cover-placeholder">📖</div>`}
      <div class="book-info">
        <div class="book-title">${escHtml(b.title)}</div>
        <div class="book-author">${escHtml(b.author)}</div>
        ${b.isbn ? `<div style="font-size:11px;color:var(--muted);">ISBN: ${b.isbn}</div>` : ''}
      </div>
    </div>
  `).join('');

  // データをキャッシュ
  window._searchResults = books;
}

function selectBook(i) {
  selectedBook = window._searchResults[i];
  showRegisterForm();
}

// ==============================
// バーコードスキャン
// ==============================
function toggleScan() {
  const area = document.getElementById('scannerArea');
  if (area.style.display === 'none') {
    area.style.display = '';
    startScan();
  } else {
    stopScan();
  }
}

function startScan() {
  if (html5Qr) return;
  html5Qr = new Html5Qrcode('qr-reader');
  html5Qr.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 150 } },
    (decodedText) => {
      stopScan();
      document.getElementById('searchInput').value = decodedText;
      searchBooks();
    },
    () => {}
  ).catch(() => {
    showToast('カメラの起動に失敗しました');
    stopScan();
  });
}

function stopScan() {
  document.getElementById('scannerArea').style.display = 'none';
  if (html5Qr) {
    html5Qr.stop().catch(() => {});
    html5Qr = null;
  }
}

// ==============================
// 登録フォーム
// ==============================
function showRegisterForm() {
  document.getElementById('searchResults').style.display = 'none';
  document.getElementById('registerArea').style.display = '';

  const b = selectedBook;
  document.getElementById('formTitle').textContent = b.title;
  document.getElementById('formAuthor').textContent = b.author;
  document.getElementById('formIsbn').textContent = b.isbn ? `ISBN: ${b.isbn}` : '';

  const coverEl = document.getElementById('formCover');
  if (b.cover_url) {
    coverEl.innerHTML = `<img class="book-cover" src="${b.cover_url}" alt="">`;
  } else {
    coverEl.innerHTML = `<div class="book-cover-placeholder">📖</div>`;
  }

  // リセット
  selectMedium('book');
  selectStatus('done');
  selectStar(0);
  document.getElementById('noteInput').value = '';
}

function cancelRegister() {
  selectedBook = null;
  document.getElementById('registerArea').style.display = 'none';
  document.getElementById('searchResults').style.display = '';
}

function selectMedium(m) {
  selectedMedium = m;
  document.querySelectorAll('[data-medium]').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.medium === m);
  });
}

function selectStatus(s) {
  selectedStatus = s;
  document.querySelectorAll('[data-status]').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.status === s);
  });
}

function selectStar(n) {
  selectedRating = n;
  document.querySelectorAll('.star-btn').forEach((btn) => {
    btn.classList.toggle('filled', parseInt(btn.dataset.star) <= n);
  });
}

async function registerBook() {
  if (!selectedBook) return;
  const note = document.getElementById('noteInput').value.trim() || null;

  try {
    await apiFetch('/api/book', {
      method: 'POST',
      body: JSON.stringify({
        isbn: selectedBook.isbn,
        title: selectedBook.title,
        author: selectedBook.author,
        cover_url: selectedBook.cover_url,
        medium: selectedMedium,
        rating: selectedRating || null,
        status: selectedStatus,
        note,
      }),
    });
    showToast('📚 登録しました！');
    selectedBook = null;
    document.getElementById('registerArea').style.display = 'none';
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('searchInput').value = '';
    loadRecentBooks();
  } catch (e) {
    showToast(`エラー: ${e.message}`);
  }
}

// ==============================
// 手動登録（書籍が見つからない場合）
// ==============================
function selectManual() {
  selectedBook = {
    isbn: null,
    title: document.getElementById('searchInput').value,
    author: '',
    cover_url: null,
  };
  showRegisterForm();
}

// ==============================
// 最近の読書一覧
// ==============================
async function loadRecentBooks() {
  try {
    const data = await apiFetch('/api/book?limit=20');
    renderRecentBooks(data.books);
  } catch {}
}

function renderRecentBooks(books) {
  const el = document.getElementById('recentBooks');
  if (!books.length) {
    el.innerHTML = '<div class="empty-msg" style="padding:32px 0;">まだ読書記録がありません</div>';
    return;
  }
  const statusLabel = { want: '読みたい', reading: '読書中', done: '読了' };
  el.innerHTML = books.map((b) => `
    <div class="book-card">
      ${b.cover_url
        ? `<img class="book-cover" src="${b.cover_url}" alt="">`
        : `<div class="book-cover-placeholder">📖</div>`}
      <div class="book-info">
        <div class="book-title">${escHtml(b.title || '（タイトルなし）')}</div>
        <div class="book-author">${escHtml(b.author || '')}</div>
        ${b.rating ? `<div class="stars">${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}</div>` : ''}
        <div><span class="book-status-badge">${statusLabel[b.status] || b.status}</span></div>
        ${b.note ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">${escHtml(b.note)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ==============================
// 感想音声入力
// ==============================
function toggleNoteVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    showToast('このブラウザは音声入力に対応していません');
    return;
  }
  if (isNoteRecording) {
    noteRecognition.stop();
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  noteRecognition = new SR();
  noteRecognition.lang = 'ja-JP';
  noteRecognition.onstart = () => {
    isNoteRecording = true;
    document.getElementById('noteVoiceBtn').classList.add('recording');
  };
  noteRecognition.onresult = (e) => {
    document.getElementById('noteInput').value += e.results[0][0].transcript;
  };
  noteRecognition.onend = () => {
    isNoteRecording = false;
    document.getElementById('noteVoiceBtn').classList.remove('recording');
  };
  noteRecognition.start();
}

// ==============================
// Toast / Utility
// ==============================
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
