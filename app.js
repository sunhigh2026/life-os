// ★ ここにGASのWebアプリURLを貼る
const API = 'https://script.google.com/macros/s/AKfycbza3PPMP3xZGjSxABCYDNvxndPkiVHMW5CzRFrf1fxNKkh6zqb19htBsH27JA57FCb4/exec';

// ---------- state ----------
let isTodo = false;
let selectedMood = '';
let selectedTags = [];
let allTagSuggestions = [];

// ---------- init ----------
window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('text-input').focus();
  loadDashboard();
  loadTagSuggestions();
});

// ---------- API call ----------
async function api(action, data = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },  // GAS CORS workaround
    body: JSON.stringify({ action, ...data })
  });
  return res.json();
}

// ---------- mood ----------
function selectMood(btn, value) {
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
  if (selectedMood === value) {
    selectedMood = '';
  } else {
    btn.classList.add('active');
    selectedMood = value;
  }
}

// ---------- tags ----------
async function loadTagSuggestions() {
  const res = await api('get_tag_suggest');
  allTagSuggestions = res.tags || [];
  renderTopTags();
}

function renderTopTags() {
  const container = document.getElementById('top-tags');
  container.innerHTML = '';
  allTagSuggestions.slice(0, 5).forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'tag-chip' + (selectedTags.includes(t.name) ? ' active' : '');
    btn.textContent = t.name;
    btn.onclick = () => toggleTag(t.name);
    container.appendChild(btn);
  });
}

function toggleTag(name) {
  const idx = selectedTags.indexOf(name);
  if (idx >= 0) selectedTags.splice(idx, 1);
  else selectedTags.push(name);
  renderTopTags();
  document.getElementById('tag-input').value = selectedTags.join(', ');
}

function onTagInput(e) {
  const val = e.target.value;
  const parts = val.split(',');
  const current = parts[parts.length - 1].trim();
  const suggest = document.getElementById('tag-suggestions');

  if (current.length === 0) {
    suggest.innerHTML = '';
    return;
  }

  const matches = allTagSuggestions.filter(t => t.name.includes(current)).slice(0, 5);
  suggest.innerHTML = '';
  matches.forEach(m => {
    const div = document.createElement('div');
    div.className = 'suggest-item';
    div.textContent = m.name + ' (' + m.count + ')';
    div.onclick = () => {
      parts[parts.length - 1] = m.name;
      e.target.value = parts.join(', ') + ', ';
      selectedTags = parts.map(p => p.trim()).filter(Boolean);
      suggest.innerHTML = '';
      renderTopTags();
    };
    suggest.appendChild(div);
  });
}

// ---------- todo toggle ----------
function toggleTodo() {
  isTodo = !isTodo;
  document.getElementById('todo-btn').classList.toggle('active', isTodo);
  document.getElementById('todo-options').style.display = isTodo ? 'flex' : 'none';
}

// ---------- voice ----------
function startVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    alert('この端末は音声入力に対応していません');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'ja-JP';
  rec.interimResults = false;
  const btn = document.getElementById('voice-btn');
  btn.classList.add('recording');
  btn.textContent = '⏺ 録音中...';

  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    const input = document.getElementById('text-input');
    input.value += (input.value ? ' ' : '') + text;
  };
  rec.onend = () => {
    btn.classList.remove('recording');
    btn.textContent = '🎤 音声';
  };
  rec.start();
}

// ---------- save ----------
async function saveEntry() {
  const text = document.getElementById('text-input').value.trim();
  if (!text && !selectedMood) {
    showToast('テキストか気分を入力してね');
    return;
  }

  const data = {
    text,
    type: isTodo ? 'todo' : 'diary',
    mood: isTodo ? '' : selectedMood,
    tag: selectedTags.join(', ') || document.getElementById('tag-input').value.trim()
  };

  if (isTodo) {
    data.due = document.getElementById('due-input').value || '';
    data.priority = document.getElementById('priority-select').value || 'mid';
    data.must_want = document.getElementById('mustwant-select').value || '';
  }

  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  const res = await api('save_entry', { data });

  saveBtn.disabled = false;
  saveBtn.textContent = '記録する';

  if (res.success) {
    showToast('記録した！');
    // reset
    document.getElementById('text-input').value = '';
    selectedMood = '';
    selectedTags = [];
    document.getElementById('tag-input').value = '';
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
    if (isTodo) toggleTodo();
    renderTopTags();
    loadDashboard();
    loadTagSuggestions();
  } else {
    showToast('エラー...');
  }
}

// ---------- complete todo ----------
async function completeTodo(id) {
  await api('update_entry', { data: { id, status: 'done' } });
  showToast('完了！');
  loadDashboard();
}

// ---------- dashboard ----------
async function loadDashboard() {
  const res = await api('get_dashboard');

  // today entries
  const todayEl = document.getElementById('today-entries');
  if (res.today && res.today.length > 0) {
    todayEl.innerHTML = res.today.map(e => {
      const time = String(e.datetime).substring(11, 16);
      const mood = e.mood ? getMoodEmoji(e.mood) : '';
      const tag  = e.tag ? `<span class="entry-tag">${e.tag}</span>` : '';
      return `<div class="entry-card">
        <div class="entry-meta">${time} ${mood} ${tag}</div>
        <div class="entry-text">${e.text || ''}</div>
      </div>`;
    }).join('');
  } else {
    todayEl.innerHTML = '<p class="empty">まだ何も記録してないよ</p>';
  }

  // todos
  const todoEl = document.getElementById('todo-list');
  const openTodos = (res.todos || []).filter(t => t.status === 'open');
  document.getElementById('todo-count').textContent = openTodos.length;
  if (openTodos.length > 0) {
    todoEl.innerHTML = openTodos.slice(0, 10).map(t => {
      const due = t.due ? `<span class="todo-due ${isOverdue(t.due) ? 'overdue' : ''}">${t.due}</span>` : '';
      const pri = t.priority === 'high' ? '🔴' : t.priority === 'low' ? '🔵' : '🟡';
      return `<div class="todo-card" onclick="completeTodo('${t.id}')">
        <span class="todo-check">☐</span>
        <span class="todo-text">${pri} ${t.text}</span>
        ${due}
      </div>`;
    }).join('');
  } else {
    todoEl.innerHTML = '<p class="empty">タスクなし ✌️</p>';
  }

  // recent done
  const doneEl = document.getElementById('done-list');
  if (res.recent_done && res.recent_done.length > 0) {
    doneEl.innerHTML = res.recent_done.map(d =>
      `<div class="done-card">✅ ${d.text} <span class="done-date">${String(d.done_at).substring(0, 10)}</span></div>`
    ).join('');
  } else {
    doneEl.innerHTML = '';
  }

  // this day
  const thisDayEl = document.getElementById('this-day');
  if (res.this_day && res.this_day.length > 0) {
    thisDayEl.innerHTML = '<h3>📅 この日の振り返り</h3>' + res.this_day.map(e => {
      const year = String(e.datetime).substring(0, 4);
      const mood = e.mood ? getMoodEmoji(e.mood) : '';
      return `<div class="entry-card past"><div class="entry-meta">${year}年 ${mood}</div><div class="entry-text">${e.text || ''}</div></div>`;
    }).join('');
  } else {
    thisDayEl.innerHTML = '';
  }

  // streak
  const streakEl = document.getElementById('streak');
  if (res.streak) {
    streakEl.innerHTML = res.streak.map(s =>
      `<div class="streak-tile ${s.active ? 'active' : ''}" title="${s.date}"></div>`
    ).join('');
  }
}

// ---------- util ----------
function getMoodEmoji(v) {
  const map = { '1': '😢', '2': '😞', '3': '😐', '4': '🙂', '5': '😊', '6': '🤩' };
  return map[String(v)] || '';
}

function isOverdue(due) {
  return due && new Date(due + 'T23:59:59') < new Date();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}
https://script.google.com/macros/s/AKfycbxoMERJedYM52LzJnj5hd5k-B_xi0UX7gwHxRUuH-HcBPiJhsF8Fp76Rf_Vqg6qB0sT/exec