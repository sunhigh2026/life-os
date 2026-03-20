// ==============================
// 設定
// ==============================
const AUTH_KEY = 'hidapia2026';

// ==============================
// 状態
// ==============================
let selectedBook = null;
let selectedMedium = 'owned';
let selectedStatus = 'done';
let selectedRating = 0;
let html5Qr = null;
let noteRecognition = null;
let isNoteRecording = false;
let currentBookFilter = 'all';
let editRating = 0;

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
        ? `<img class="book-cover" src="${b.cover_url}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="book-cover-placeholder" style="display:none;">📖</div>`
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
  selectMedium('owned');
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
  const tag = document.getElementById('bookTagInput').value.trim() || null;
  const end_date = document.getElementById('endDateInput').value || null;

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
        tag,
        end_date,
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
// ステータスフィルター
// ==============================
function setBookFilter(status) {
  currentBookFilter = status;
  document.querySelectorAll('#bookFilterTabs .filter-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(`book-tab-${status}`).classList.add('active');
  loadRecentBooks();
}

// ==============================
// 読書一覧
// ==============================
async function loadRecentBooks() {
  try {
    const param = currentBookFilter !== 'all' ? `&status=${currentBookFilter}` : '';
    const data = await apiFetch(`/api/book?limit=100${param}`);
    renderRecentBooks(data.books);
  } catch {}
}

function renderRecentBooks(books) {
  const el = document.getElementById('recentBooks');
  if (!books.length) {
    const labels = { all: '読書記録', want: '「読みたい」の本', reading: '「読書中」の本', done: '「読了」の本' };
    el.innerHTML = `<div class="empty-msg" style="padding:32px 0;">まだ${labels[currentBookFilter] || '読書記録'}がありません</div>`;
    return;
  }
  const statusLabel = { want: '📌 読みたい', reading: '📖 読書中', done: '✅ 読了' };
  el.innerHTML = books.map((b) => {
    const bd = encodeURIComponent(JSON.stringify(b));
    return `
      <div class="book-card">
        ${b.cover_url
          ? `<img class="book-cover" src="${b.cover_url}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="book-cover-placeholder" style="display:none;">📖</div>`
          : `<div class="book-cover-placeholder">📖</div>`}
        <div class="book-info">
          <div class="book-title">${escHtml(b.title || '（タイトルなし）')}</div>
          <div class="book-author">${escHtml(b.author || '')}</div>
          ${b.rating ? `<div class="stars">${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}</div>` : ''}
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap;">
            <span class="book-status-badge">${statusLabel[b.status] || b.status}</span>
            ${b.tag ? `<span style="font-size:11px;color:var(--accent);">#${escHtml(b.tag)}</span>` : ''}
            ${b.end_date ? `<span style="font-size:11px;color:var(--muted);">読了: ${b.end_date}</span>` : ''}
            <button onclick="openBookEdit(decodeURIComponent('${bd}'))"
              style="font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:var(--radius-chip);background:#f5f5f5;cursor:pointer;">✏️ 編集</button>
          </div>
          ${b.note ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;white-space:pre-line;">${escHtml(b.note)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ==============================
// 書籍編集モーダル
// ==============================
function openBookEdit(bookJson) {
  const b = JSON.parse(bookJson);
  document.getElementById('editBookId').value = b.id;
  document.getElementById('editBookTitle').textContent = b.title || '';
  document.getElementById('editBookAuthor').textContent = b.author || '';

  const coverEl = document.getElementById('editBookCover');
  coverEl.innerHTML = b.cover_url
    ? `<img class="book-cover" src="${b.cover_url}" alt="">`
    : `<div class="book-cover-placeholder">📖</div>`;

  document.getElementById('editBookNote').value = b.note || '';
  document.getElementById('editEndDate').value = b.end_date || '';
  document.getElementById('editBookTag').value = b.tag || '';
  selectEditMedium(b.medium || 'owned');
  selectEditStatus(b.status || 'done');
  selectEditStar(b.rating || 0);

  document.getElementById('bookEditModal').style.display = 'flex';
}

function closeBookEdit() {
  document.getElementById('bookEditModal').style.display = 'none';
}

function selectEditMedium(m) {
  document.querySelectorAll('[data-edit-medium]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.editMedium === m);
  });
}

function selectEditStatus(s) {
  document.querySelectorAll('[data-edit-status]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.editStatus === s);
  });
}

function selectEditStar(n) {
  editRating = n;
  document.querySelectorAll('[data-edit-star]').forEach(btn => {
    btn.classList.toggle('filled', parseInt(btn.dataset.editStar) <= n);
  });
}

async function deleteBook() {
  const id = document.getElementById('editBookId').value;
  if (!confirm('この本を削除しますか？')) return;
  try {
    await apiFetch(`/api/book?id=${id}`, { method: 'DELETE' });
    showToast('削除しました');
    closeBookEdit();
    loadRecentBooks();
  } catch (e) {
    showToast(`エラー: ${e.message}`);
  }
}

async function saveBookEdit() {
  const id = document.getElementById('editBookId').value;
  const note = document.getElementById('editBookNote').value.trim() || null;
  const status = document.querySelector('[data-edit-status].selected')?.dataset.editStatus || 'done';
  const medium = document.querySelector('[data-edit-medium].selected')?.dataset.editMedium || 'owned';
  const rating = editRating || null;
  const tag = document.getElementById('editBookTag').value.trim() || null;
  const end_date = document.getElementById('editEndDate').value || null;

  try {
    await apiFetch('/api/book', {
      method: 'PUT',
      body: JSON.stringify({ id, status, medium, rating, note, tag, end_date }),
    });
    showToast('✅ 更新しました');
    closeBookEdit();
    loadRecentBooks();
  } catch (e) {
    showToast(`エラー: ${e.message}`);
  }
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
