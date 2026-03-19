// ==============================
// 設定: デプロイ後に自分のキーに変更してください
// ==============================
const AUTH_KEY = 'hidapia2026';

// ==============================
// 状態
// ==============================
let mode = 'diary'; // 'diary' | 'todo'
let selectedMood = null;
let selectedPriority = 'mid';
let recognition = null;
let isRecording = false;
let topTags = [];

const MOODS = { 1: '😢', 2: '😞', 3: '😐', 4: '🙂', 5: '😊', 6: '🤩' };

// ==============================
// 初期化
// ==============================
document.addEventListener('DOMContentLoaded', () => {
  setNow();
  loadDashboard();
  loadTopTags();
});

// ==============================
// API ユーティリティ
// ==============================
function apiUrl(path) { return path; }

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_KEY}`,
    ...(options.headers || {}),
  };
  const res = await fetch(apiUrl(path), { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ==============================
// 日時
// ==============================
function setNow() {
  const now = new Date();
  const local = new Date(now - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  document.getElementById('datetimeInput').value = local;
}

// ==============================
// モード切替
// ==============================
function setMode(m) {
  mode = m;
  const diaryBtn = document.getElementById('diaryBtn');
  const todoBtn = document.getElementById('todoBtn');
  const moodRow = document.getElementById('moodRow');
  const todoOptions = document.getElementById('todoOptions');
  const submitBtn = document.getElementById('submitBtn');

  if (m === 'diary') {
    diaryBtn.className = 'mode-btn active';
    todoBtn.className = 'mode-btn';
    moodRow.style.display = '';
    todoOptions.style.display = 'none';
    submitBtn.className = 'btn-submit';
  } else {
    diaryBtn.className = 'mode-btn';
    todoBtn.className = 'mode-btn todo-active';
    moodRow.style.display = 'none';
    todoOptions.style.display = '';
    submitBtn.className = 'btn-submit todo-mode';
  }
}

// ==============================
// Mood
// ==============================
function selectMood(v) {
  selectedMood = v;
  document.querySelectorAll('.mood-btn').forEach((btn) => {
    btn.classList.toggle('selected', parseInt(btn.dataset.mood) === v);
  });
}

// ==============================
// Priority
// ==============================
function selectPriority(p) {
  selectedPriority = p;
  document.querySelectorAll('.priority-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.priority === p);
  });
}

// ==============================
// タグ
// ==============================
async function loadTopTags() {
  try {
    const data = await apiFetch('/api/tag');
    topTags = data.tags.slice(0, 5);
    renderTopTags();
  } catch {}
}

function renderTopTags() {
  const el = document.getElementById('tagSuggestions');
  el.innerHTML = topTags
    .map((t) => `<button class="tag-chip" onclick="setTag('${t.tag}')">${t.tag}</button>`)
    .join('');
}

function setTag(tag) {
  document.getElementById('tagInput').value = tag;
  hideTagDropdown();
}

let tagDebounce;
async function onTagInput() {
  clearTimeout(tagDebounce);
  const q = document.getElementById('tagInput').value;
  if (!q) { hideTagDropdown(); return; }
  tagDebounce = setTimeout(async () => {
    try {
      const data = await apiFetch(`/api/tag?q=${encodeURIComponent(q)}`);
      showTagDropdown(data.tags);
    } catch {}
  }, 200);
}

function showTagDropdown(tags) {
  const el = document.getElementById('tagDropdown');
  if (!tags.length) { hideTagDropdown(); return; }
  el.innerHTML = tags
    .map((t) => `<div class="tag-dropdown-item" onclick="setTag('${t.tag}')">${t.tag}</div>`)
    .join('');
  el.style.display = 'block';
}

function hideTagDropdown() {
  document.getElementById('tagDropdown').style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.tag-row')) hideTagDropdown();
});

// ==============================
// 音声入力
// ==============================
function toggleVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    showToast('このブラウザは音声入力に対応していません');
    return;
  }
  if (isRecording) {
    recognition.stop();
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'ja-JP';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    document.getElementById('voiceBtn').classList.add('recording');
  };
  recognition.onresult = (e) => {
    document.getElementById('textInput').value += e.results[0][0].transcript;
  };
  recognition.onend = () => {
    isRecording = false;
    document.getElementById('voiceBtn').classList.remove('recording');
  };
  recognition.onerror = () => {
    isRecording = false;
    document.getElementById('voiceBtn').classList.remove('recording');
    showToast('音声認識エラー');
  };
  recognition.start();
}

// ==============================
// 記録送信
// ==============================
async function submit() {
  const datetime = document.getElementById('datetimeInput').value;
  const text = document.getElementById('textInput').value.trim();
  const tag = document.getElementById('tagInput').value.trim() || null;

  if (!datetime) { showToast('日時を入力してください'); return; }
  if (!text) { showToast('テキストを入力してください'); return; }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;

  try {
    if (mode === 'diary') {
      await apiFetch('/api/entry', {
        method: 'POST',
        body: JSON.stringify({ datetime, mood: selectedMood, tag, text }),
      });
      showToast('📝 記録しました！');
    } else {
      const due = document.getElementById('dueDate').value || null;
      await apiFetch('/api/todo', {
        method: 'POST',
        body: JSON.stringify({ datetime, text, tag, priority: selectedPriority, due }),
      });
      showToast('☑ ToDoを追加しました！');
    }

    // リセット
    document.getElementById('textInput').value = '';
    document.getElementById('tagInput').value = '';
    document.getElementById('dueDate').value = '';
    setNow();
    selectedMood = null;
    document.querySelectorAll('.mood-btn').forEach((b) => b.classList.remove('selected'));

    loadDashboard();
    loadTopTags();
  } catch (e) {
    showToast(`エラー: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ==============================
// ダッシュボード
// ==============================
async function loadDashboard() {
  try {
    const data = await apiFetch('/api/dashboard');
    renderTodayEntries(data.todayEntries);
    renderTodos(data.openTodos);
    renderLookback(data.lookback);
    renderRecentDone(data.recentDone);
    renderStreak(data.streakData, data.today);
  } catch (e) {
    console.error('Dashboard error:', e);
  }
}

function renderTodayEntries(entries) {
  const el = document.getElementById('todayList');
  document.getElementById('todayCount').textContent = entries.length ? `${entries.length}件` : '';
  if (!entries.length) {
    el.innerHTML = '<div class="empty-msg">今日の記録はまだありません</div>';
    return;
  }
  el.innerHTML = entries.map((e) => `
    <div class="entry-item">
      <div class="entry-time">${e.datetime.slice(11, 16)}</div>
      <div class="entry-mood">${e.mood ? MOODS[e.mood] : ''}</div>
      <div class="entry-content">
        ${e.tag ? `<div class="entry-tag">#${e.tag}</div>` : ''}
        <div class="entry-text">${escHtml(e.text || '')}</div>
      </div>
    </div>
  `).join('');
}

function renderTodos(todos) {
  const el = document.getElementById('todoList');
  document.getElementById('todoCount').textContent = todos.length ? `${todos.length}件` : '';
  if (!todos.length) {
    el.innerHTML = '<div class="empty-msg">やることはありません 🎉</div>';
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = todos.map((t) => {
    const overdue = t.due && t.due < today;
    const priority = t.priority || 'mid';
    const priorityLabel = { high: '高', mid: '普通', low: '低' }[priority];
    const td = encodeURIComponent(JSON.stringify(t));
    return `
      <div class="todo-item">
        <div class="todo-check" onclick="completeTodo('${t.id}', this.closest('.todo-item'))"></div>
        <div class="todo-content" onclick="completeTodo('${t.id}', this.closest('.todo-item'))">
          <div class="todo-text">${escHtml(t.text)}</div>
          <div class="todo-meta ${overdue ? 'overdue' : ''}">
            ${t.due ? `📅 ${t.due}${overdue ? ' 期限超過！' : ''}` : ''}
            ${t.tag ? ` #${t.tag}` : ''}
          </div>
        </div>
        <div class="priority-badge ${priority}" style="cursor:pointer;" onclick="openTodoEdit(decodeURIComponent('${td}'))">${priorityLabel} ✏️</div>
      </div>
    `;
  }).join('');
}

// ==============================
// Todo編集モーダル
// ==============================
function openTodoEdit(todoJson) {
  const t = JSON.parse(todoJson);
  document.getElementById('todoEditId').value = t.id;
  document.getElementById('todoEditText').value = t.text || '';
  document.getElementById('todoEditTag').value = t.tag || '';
  document.getElementById('todoEditDue').value = t.due || '';
  document.querySelectorAll('.todo-edit-priority').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.priority === (t.priority || 'mid'));
  });
  document.getElementById('todoEditModal').style.display = 'flex';
}

function closeTodoEdit() {
  document.getElementById('todoEditModal').style.display = 'none';
}

async function saveTodoEdit() {
  const id = document.getElementById('todoEditId').value;
  const text = document.getElementById('todoEditText').value.trim();
  const tag = document.getElementById('todoEditTag').value.trim() || null;
  const due = document.getElementById('todoEditDue').value || null;
  const priority = document.querySelector('.todo-edit-priority.selected')?.dataset.priority || 'mid';

  try {
    await apiFetch('/api/todo', {
      method: 'PUT',
      body: JSON.stringify({ id, text, tag, due, priority }),
    });
    showToast('✅ 更新しました');
    closeTodoEdit();
    loadDashboard();
  } catch (e) {
    showToast(`エラー: ${e.message}`);
  }
}

function selectTodoEditPriority(p) {
  document.querySelectorAll('.todo-edit-priority').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.priority === p);
  });
}

async function completeTodo(id, el) {
  el.style.opacity = '0.5';
  try {
    await apiFetch('/api/todo', {
      method: 'PUT',
      body: JSON.stringify({ id, status: 'done' }),
    });
    showToast('✅ 完了！');
    loadDashboard();
  } catch (e) {
    el.style.opacity = '1';
    showToast(`エラー: ${e.message}`);
  }
}

function renderLookback(entries) {
  const section = document.getElementById('sectionLookback');
  const el = document.getElementById('lookbackList');
  if (!entries.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  el.innerHTML = entries.map((e) => `
    <div class="entry-item">
      <div class="entry-time">${e.datetime.slice(0, 10)}<br>${e.datetime.slice(11, 16)}</div>
      <div class="entry-mood">${e.mood ? MOODS[e.mood] : ''}</div>
      <div class="entry-content">
        ${e.tag ? `<div class="entry-tag">#${e.tag}</div>` : ''}
        <div class="entry-text">${escHtml(e.text || '')}</div>
      </div>
    </div>
  `).join('');
}

function renderRecentDone(todos) {
  const el = document.getElementById('doneList');
  if (!todos.length) {
    el.innerHTML = '<div class="empty-msg">まだ完了したToDoはありません</div>';
    return;
  }
  el.innerHTML = todos.map((t) => `
    <div class="done-item">
      <span class="done-check">✅</span>
      <span class="done-text">${escHtml(t.text)}</span>
    </div>
  `).join('');
}

function renderStreak(data, today) {
  const el = document.getElementById('streakGrid');
  const map = {};
  data.forEach((d) => { map[d.date] = d.count; });

  const cells = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    cells.push(`<div class="streak-cell ${map[key] ? 'has-entry' : ''}" title="${key}"></div>`);
  }
  el.innerHTML = cells.join('');
}

// ==============================
// Toast
// ==============================
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ==============================
// Utility
// ==============================
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
