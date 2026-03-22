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
let selectedCategory = '';
let recognition = null;
let isRecording = false;
let topTags = [];
let aiClassifyTimer = null;

const MOODS = { 1: '😢', 2: '😞', 3: '😐', 4: '🙂', 5: '😊', 6: '🤩' };

// ==============================
// 初期化
// ==============================
document.addEventListener('DOMContentLoaded', () => {
  setNow();
  loadDashboard();
  loadTopTags();
  loadCalendar();
  loadMenstrualStats();
  loadFitness();
  loadGoals();
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
  document.querySelectorAll('#todoOptions .priority-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.priority === p);
  });
}

// ==============================
// Category (must/want)
// ==============================
function selectCategory(c) {
  selectedCategory = c;
  document.querySelectorAll('#todoOptions .category-btn').forEach((btn) => {
    const match = btn.dataset.category === c;
    btn.classList.toggle('selected', match);
    btn.style.borderColor = match ? 'var(--accent)' : 'var(--border)';
    btn.style.background = match ? '#eaf3ff' : 'var(--bg)';
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
// AI分類（テキスト入力時にバックグラウンドで分類）
// ==============================
function onTextInput() {
  clearTimeout(aiClassifyTimer);
  const text = document.getElementById('textInput').value.trim();
  if (text.length < 5) return; // 短すぎるテキストは無視
  aiClassifyTimer = setTimeout(() => classifyInput(text), 800);
}

async function classifyInput(text) {
  try {
    const data = await apiFetch('/api/process-input', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    if (data.confidence < 0.5) return; // 自信がない場合はスキップ

    // AIの提案をヒントとして表示（自動切替はしない）
    const hint = document.getElementById('aiClassifyHint');
    if (!hint) return;

    if (data.mode === 'todo' && mode === 'diary') {
      hint.innerHTML = `<span style="cursor:pointer;" onclick="applyAiClassify('todo')">💡 ToDoかも？ タップで切替</span>`;
      hint.style.display = '';
      hint._aiData = data;
    } else if (data.mode === 'diary' && mode === 'todo') {
      hint.innerHTML = `<span style="cursor:pointer;" onclick="applyAiClassify('diary')">💡 日記かも？ タップで切替</span>`;
      hint.style.display = '';
      hint._aiData = data;
    } else if (data.mode === 'query') {
      hint.innerHTML = `<span style="cursor:pointer;" onclick="applyAiClassify('query')">💡 ピアちゃんに聞く？ タップでチャットへ</span>`;
      hint.style.display = '';
      hint._aiData = data;
    } else {
      hint.style.display = 'none';
    }
  } catch (_) {}
}

function applyAiClassify(targetMode) {
  const hint = document.getElementById('aiClassifyHint');
  const data = hint?._aiData;
  hint.style.display = 'none';

  if (targetMode === 'query') {
    const text = document.getElementById('textInput').value.trim();
    localStorage.setItem('chatAutoMsg', text);
    window.location.href = '/chat.html';
    return;
  }

  setMode(targetMode);

  if (data) {
    // AI提案を適用
    if (data.suggested_tag && !document.getElementById('tagInput').value) {
      document.getElementById('tagInput').value = data.suggested_tag;
    }
    if (targetMode === 'todo') {
      if (data.suggested_priority) selectPriority(data.suggested_priority);
      if (data.suggested_category) selectCategory(data.suggested_category);
      if (data.suggested_due) document.getElementById('dueDate').value = data.suggested_due;
    }
    if (targetMode === 'diary' && data.suggested_mood) {
      selectMood(data.suggested_mood);
    }
  }
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
      const category = selectedCategory || null;
      await apiFetch('/api/todo', {
        method: 'POST',
        body: JSON.stringify({ datetime, text, tag, priority: selectedPriority, due, category }),
      });
      showToast('☑ ToDoを追加しました！');
    }

    // リセット
    document.getElementById('textInput').value = '';
    document.getElementById('tagInput').value = '';
    document.getElementById('dueDate').value = '';
    setNow();
    selectedMood = null;
    selectedCategory = '';
    document.querySelectorAll('.mood-btn').forEach((b) => b.classList.remove('selected'));
    // カテゴリリセット
    document.querySelectorAll('#todoOptions .category-btn').forEach((btn) => {
      const isNone = btn.dataset.category === '';
      btn.classList.toggle('selected', isNone);
      btn.style.borderColor = isNone ? 'var(--accent)' : 'var(--border)';
      btn.style.background = isNone ? '#eaf3ff' : 'var(--bg)';
    });
    // AI分類ヒントを消す
    const hint = document.getElementById('aiClassifyHint');
    if (hint) hint.style.display = 'none';

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
    renderDailySummary(data.summary, data.today);
    renderTodayEntries(data.todayEntries);
    renderTodos(data.openTodos);
    renderRecentDone(data.recentDone);
    renderStreak(data.streakData, data.today);
  } catch (e) {
    console.error('Dashboard error:', e);
  }
}

// ==============================
// 日次概要カード
// ==============================
function renderDailySummary(summary, today) {
  const card = document.getElementById('dailySummaryCard');
  if (!card || !summary) return;

  const moodEmoji = summary.todayAvgMood ? MOODS[Math.round(summary.todayAvgMood)] || '' : '';
  const items = [];

  // タスク状況
  if (summary.openCount > 0 || summary.todayDoneCount > 0) {
    let taskText = '';
    if (summary.todayDoneCount > 0) taskText += `✅ ${summary.todayDoneCount}件完了`;
    if (summary.openCount > 0) taskText += `${taskText ? ' / ' : ''}📋 残り${summary.openCount}件`;
    if (summary.mustCount > 0) taskText += ` (🔥Must ${summary.mustCount})`;
    items.push(taskText);
  }

  // 期限超過
  if (summary.overdueCount > 0) {
    items.push(`<span style="color:#c53030;">🚨 期限超過 ${summary.overdueCount}件</span>`);
  }

  // 気分
  if (moodEmoji) {
    items.push(`今日の気分: ${moodEmoji}`);
  }

  // ストリーク
  if (summary.streakCount > 0) {
    items.push(`🔥 ${summary.streakCount}日連続記録中！`);
  }

  card.style.display = '';

  // 日付（曜日付き）
  const WEEKDAYS = ['日','月','火','水','木','金','土'];
  let dateLabel = '';
  if (today) {
    const d = new Date(today + 'T00:00:00');
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const wd = WEEKDAYS[d.getDay()];
    dateLabel = `${m}/${day} (${wd})`;
  }

  // ピアちゃんコメント
  let piaMsg = '';
  const piaImg = getPiaImage('normal');
  if (!summary.todayEntryCount || summary.todayEntryCount === 0) {
    piaMsg = 'まだなにも書いてないよ〜✏️';
  } else if (summary.openCount === 0 && summary.todayDoneCount > 0) {
    piaMsg = '全部おわったの！すごい〜！🎉';
  } else if (summary.todayAvgMood && summary.todayAvgMood >= 5) {
    piaMsg = 'いい日だね〜！☀️';
  } else if (summary.streakCount >= 3) {
    piaMsg = `${summary.streakCount}日連続だよ！えらい〜🔥`;
  } else {
    piaMsg = 'きょうもがんばってるね〜🐾';
  }

  card.className = 'daily-summary-card';
  card.innerHTML = `
    <div class="pia-comment" style="margin-bottom:0;">
      <img src="${piaImg}" alt="ピアちゃん" class="pia-icon-sm" onerror="this.src='/icon-pia.png'">
      <div class="pia-bubble">${piaMsg}</div>
      <span style="margin-left:auto;font-size:11px;color:var(--text-sub);white-space:nowrap;">${dateLabel}</span>
    </div>
    ${items.length ? `<div style="font-size:13px;color:var(--text-main);display:flex;flex-direction:column;gap:4px;padding-top:2px;">
      ${items.map(i => `<div>${i}</div>`).join('')}
    </div>` : ''}
  `;
}

// ピアちゃん画像セレクター（複数画像を活用）
const PIA_IMAGES = {
  // 顔アップ（コメント・バブル用）
  normal:   ['/pia-normal.png', '/pia-happy.png'],
  happy:    ['/pia-happy.png'],
  thinking: ['/pia-thinking.png'],
  // フルボディ（空状態・大きめ表示用）
  cheer:    ['/pia-full-1.png', '/pia-full-2.png', '/pia-full-3.png', '/pia-cheer.png'],
  full:     ['/pia-full-1.png', '/pia-full-2.png', '/pia-full-3.png',
             '/pia-full-4.png', '/pia-full-5.png', '/pia-full-6.png', '/pia-full-7.png'],
};

function getPiaImage(type) {
  const candidates = PIA_IMAGES[type] || PIA_IMAGES.normal;
  // ページロードごとにランダム、だが再レンダリングで変わらないよう日付シード
  const seed = (new Date().getDate() + new Date().getHours()) % candidates.length;
  return candidates[seed];
}

function getRandomPiaFull() {
  const imgs = PIA_IMAGES.full;
  return imgs[Math.floor(Math.random() * imgs.length)];
}

function renderTodayEntries(entries) {
  const el = document.getElementById('todayList');
  document.getElementById('todayCount').textContent = entries.length ? `${entries.length}件` : '';
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state">
      <img src="${getPiaImage('cheer')}" alt="ピアちゃん" class="pia-icon-lg" onerror="this.src='/icon-pia.png'">
      <p>まだなにも書いてないよ〜<br>なにか書いてみる？</p>
    </div>`;
    return;
  }
  el.innerHTML = entries.map((e) => `
    <div class="entry-item">
      <div class="entry-time">${e.datetime.slice(11, 16)}</div>
      <div class="entry-mood">${e.mood ? MOODS[e.mood] : ''}</div>
      <div class="entry-content">
        ${e.tag ? `<div class="entry-tag">#${e.tag}</div>` : ''}
        <div class="entry-text">${escHtml(e.text || '').replace(/\n/g, '<br>')}</div>
      </div>
    </div>
  `).join('');
}

function renderTodos(todos) {
  const el = document.getElementById('todoList');
  // サブタスクはダッシュボードでは非表示
  const topLevel = todos.filter(t => !t.parent_id);
  document.getElementById('todoCount').textContent = topLevel.length ? `${topLevel.length}件` : '';
  if (!topLevel.length) {
    el.innerHTML = `<div class="empty-state">
      <img src="${getPiaImage('full')}" alt="ピアちゃん" class="pia-icon-lg" onerror="this.src='/icon-pia.png'">
      <p>やることはないよ！<br>のんびりしよ〜🌸</p>
    </div>`;
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = topLevel.map((t) => {
    const overdue = t.due && t.due < today;
    const priority = t.priority || 'mid';
    const priorityLabel = { high: '高', mid: '普通', low: '低' }[priority];
    const categoryBadge = t.category === 'must' ? '<span class="cat-badge cat-must">🔥Must</span>'
      : t.category === 'want' ? '<span class="cat-badge cat-want">💫Want</span>'
      : '';
    const td = encodeURIComponent(JSON.stringify(t));
    return `
      <div class="todo-item${overdue ? ' overdue-item' : ''}">
        <div class="todo-check" onclick="completeTodo('${t.id}', this.closest('.todo-item'))"></div>
        <div class="todo-content" onclick="completeTodo('${t.id}', this.closest('.todo-item'))">
          <div class="todo-text">${categoryBadge}${escHtml(t.text)}</div>
          <div class="todo-meta ${overdue ? 'overdue' : ''}">
            ${t.due ? `📅 ${t.due}${overdue ? ' 期限超過！' : ''}` : ''}
            ${t.tag ? ` #${t.tag}` : ''}
          </div>
        </div>
        <div class="priority-badge ${priority}"><span class="priority-dot"></span>${priorityLabel}</div>
        <button class="edit-btn" onclick="openTodoEdit(decodeURIComponent('${td}'))" title="編集">✏️</button>
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
  // カテゴリ設定
  selectTodoEditCategory(t.category || '');
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
  const category = document.querySelector('.todo-edit-category.selected')?.dataset.category || null;

  try {
    await apiFetch('/api/todo', {
      method: 'PUT',
      body: JSON.stringify({ id, text, tag, due, priority, category }),
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

function selectTodoEditCategory(c) {
  document.querySelectorAll('.todo-edit-category').forEach((btn) => {
    const match = btn.dataset.category === c;
    btn.classList.toggle('selected', match);
    btn.style.borderColor = match ? 'var(--accent)' : 'var(--border)';
    btn.style.background = match ? '#eaf3ff' : 'var(--bg)';
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
      <button class="reopen-btn" onclick="reopenTodo('${t.id}', this.closest('.done-item'))" title="復帰">↩</button>
    </div>
  `).join('');
}

async function reopenTodo(id, el) {
  el.style.opacity = '0.5';
  try {
    await apiFetch('/api/todo', {
      method: 'PUT',
      body: JSON.stringify({ id, status: 'open' }),
    });
    showToast('↩ 復帰しました');
    loadDashboard();
  } catch (e) {
    el.style.opacity = '1';
    showToast(`エラー: ${e.message}`);
  }
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
// フィットネス
// ==============================
async function loadFitness() {
  try {
    const data = await apiFetch('/api/fitness?days=7');
    const section = document.getElementById('sectionFitness');
    const el = document.getElementById('fitnessInfo');
    const today = data.today;
    const recent = data.fitness || [];
    if (!recent.length) return;

    section.style.display = '';

    const latest = today || recent[0];
    const isToday = !!today;
    const dateLabel = isToday ? '' : `<span style="font-size:11px;color:var(--text-sub);">(${latest.date.slice(5).replace('-', '/')} 時点)</span>`;

    const steps = latest?.steps || 0;
    const activeMin = latest?.active_minutes || 0;
    const latestWeight = recent.find(r => r.weight);
    const weight = latestWeight?.weight || null;

    // ステップ目標10000で達成率
    const goalSteps = 10000;
    const stepPct = Math.min(100, Math.round((steps / goalSteps) * 100));

    // 詳細行
    const details = [];
    if (activeMin) details.push(`🏃 活動 ${activeMin}分`);
    if (weight) details.push(`⚖️ ${weight} kg`);

    // メインレイアウト
    el.innerHTML = `
      <div class="fitness-main">
        <div class="fitness-steps">
          <span class="fitness-steps-num">${steps ? steps.toLocaleString() : '—'}</span>
          <span class="fitness-steps-label">歩 ${dateLabel}</span>
          ${steps ? `<div style="width:100%;height:4px;background:var(--border);border-radius:2px;margin-top:6px;overflow:hidden;">
            <div style="height:100%;width:${stepPct}%;background:var(--primary);border-radius:2px;"></div>
          </div>
          <span style="font-size:9px;color:var(--text-sub);margin-top:2px;">${stepPct}% / 目標1万歩</span>` : ''}
        </div>
        <div class="fitness-details">
          ${details.map(d => `<div class="fitness-detail-row">${d}</div>`).join('')}
          ${!details.length && !steps ? '<div class="fitness-detail-row" style="color:var(--text-sub);">データなし</div>' : ''}
        </div>
      </div>
    `;

    // 直近7日の歩数バーチャート
    if (recent.length >= 2) {
      const barData = recent.slice(0, 7).reverse();
      const maxSteps = Math.max(...barData.map(r => r.steps || 0), 1);
      const todayDate = today?.date || '';
      const bars = barData.map(r => {
        const pct = Math.max(2, Math.round(((r.steps || 0) / maxSteps) * 48));
        const isTd = r.date === todayDate;
        return `<div class="fitness-bar-group">
          <div class="fitness-bar-fill${isTd ? ' today' : ''}" style="height:${pct}px;"></div>
          <span class="fitness-bar-date">${r.date.slice(8)}</span>
        </div>`;
      }).join('');
      el.innerHTML += `<div class="fitness-chart">${bars}</div>`;
    }
  } catch (_) {}
}

// ==============================
// 目標
// ==============================
async function loadGoals() {
  try {
    const data = await apiFetch('/api/goal?status=active');
    const section = document.getElementById('sectionGoals');
    const el = document.getElementById('goalList');
    const goals = data.goals || [];
    if (!goals.length) return;

    section.style.display = '';
    el.innerHTML = goals.map(g => {
      const hasQuantity = g.target && g.unit;
      const pct = (hasQuantity && g.progress != null) ? Math.min(100, Math.round(g.progress)) : null;
      const daysLeft = g.deadline ? Math.ceil((new Date(g.deadline) - new Date()) / 86400000) : null;
      const deadlineTag = (daysLeft != null && daysLeft <= 7 && daysLeft >= 0) ? ` <span style="color:#e53935;font-size:10px;">⚠️${daysLeft}日</span>` : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;">
        <div style="flex:1;">
          <div style="font-size:13px;">${escHtml(g.goal)}${deadlineTag}</div>
          ${pct != null ? `<div style="display:flex;align-items:center;gap:6px;">
            <div style="background:#eee;border-radius:4px;height:6px;flex:1;overflow:hidden;">
              <div style="background:${pct >= 100 ? '#48bb78' : '#4a9eff'};height:100%;width:${pct}%;border-radius:4px;"></div>
            </div>
            <span style="font-size:11px;color:var(--muted);white-space:nowrap;">${g.current || 0}/${g.target}${g.unit || ''}</span>
          </div>` : ''}
          ${!hasQuantity && g.deadline ? `<div style="font-size:11px;color:var(--muted);">期限: ${g.deadline}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (_) {}
}

// ==============================
// 生理周期予測
// ==============================
async function loadMenstrualStats() {
  try {
    const data = await apiFetch('/api/menstrual-stats');
    const section = document.getElementById('sectionMenstrual');
    const el = document.getElementById('menstrualInfo');
    if (data.detected && data.nextPrediction) {
      section.style.display = '';
      const emoji = data.daysUntil <= 3 ? '🌸' : '🩷';
      el.innerHTML = `${emoji} ${escHtml(data.message)}`;
    }
  } catch (_) {}
}

// ==============================
// Googleカレンダー
// ==============================
async function loadCalendar() {
  const section = document.getElementById('sectionCalendar');
  const slider = document.getElementById('weekSlider');
  const countEl = document.getElementById('calendarCount');
  try {
    const data = await apiFetch('/api/calendar?action=week');
    if (!data.connected) {
      section.style.display = '';
      document.getElementById('weekNav').innerHTML = '';
      slider.innerHTML = `<div class="empty-msg" style="min-width:100%;padding:16px;">
        <button class="btn-submit" onclick="connectCalendar()" style="width:auto;padding:8px 20px;font-size:13px;">📅 Googleカレンダーを連携</button>
      </div>`;
      countEl.textContent = '';
      return;
    }
    section.style.display = '';
    renderWeekSlider(data.events);
  } catch (e) {
    section.style.display = 'none';
  }
}

function renderWeekSlider(events) {
  const slider = document.getElementById('weekSlider');
  const nav = document.getElementById('weekNav');
  const countEl = document.getElementById('calendarCount');

  const WEEKDAYS = ['日','月','火','水','木','金','土'];
  const now = new Date();
  const todayStr = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  // イベントを日付でグループ化
  const byDate = {};
  events.forEach(ev => {
    const dateKey = (ev.start || '').slice(0, 10);
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(ev);
  });

  countEl.textContent = events.length ? `${events.length}件` : '';

  let navHtml = '';
  let sliderHtml = '';

  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const dateStr = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const wd = WEEKDAYS[d.getDay()];
    const day = d.getDate();
    const isToday = dateStr === todayStr;
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const dayEvents = byDate[dateStr] || [];

    // ナビ項目
    const navClasses = ['week-nav-item'];
    if (isToday) navClasses.push('today', 'active');
    if (isWeekend) navClasses.push('weekend');
    navHtml += `<div class="${navClasses.join(' ')}" data-index="${i}" onclick="scrollToWeekDay(${i})">
      <div>${wd}</div><div style="font-size:10px;">${day}</div>
    </div>`;

    // デイカード
    let eventsHtml;
    if (dayEvents.length === 0) {
      eventsHtml = '<div class="week-day-empty">予定なし</div>';
    } else {
      eventsHtml = dayEvents.map(ev => {
        const time = ev.allDay ? '終日' : formatEventTime(ev.start, ev.end);
        return `<div class="week-event-item">
          <span class="week-event-time">${time}</span>
          <div>
            <div class="week-event-title">${escHtml(ev.summary)}</div>
            ${ev.location ? `<div class="week-event-location">📍 ${escHtml(ev.location)}</div>` : ''}
          </div>
        </div>`;
      }).join('');
    }

    sliderHtml += `<div class="week-day-card" data-index="${i}">
      <div class="week-day-header">
        <span class="week-day-name">${wd}</span>
        <span class="week-day-date">${d.getMonth() + 1}/${day}</span>
        ${isToday ? '<span class="week-day-badge">今日</span>' : ''}
      </div>
      <div class="week-day-events">${eventsHtml}</div>
    </div>`;
  }

  nav.innerHTML = navHtml;
  slider.innerHTML = sliderHtml;

  // スクロールリスナー（重複防止）
  slider.removeEventListener('scroll', onWeekSliderScroll);
  slider.addEventListener('scroll', onWeekSliderScroll);
}

function scrollToWeekDay(index) {
  const slider = document.getElementById('weekSlider');
  slider.scrollTo({ left: index * slider.offsetWidth, behavior: 'smooth' });
}

function onWeekSliderScroll() {
  const slider = document.getElementById('weekSlider');
  const index = Math.round(slider.scrollLeft / slider.offsetWidth);
  document.querySelectorAll('.week-nav-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
}

function formatEventTime(start, end) {
  const s = start.slice(11, 16);
  const e = end.slice(11, 16);
  return s && e ? `${s}〜${e}` : s || '';
}

async function connectCalendar() {
  try {
    const data = await apiFetch('/api/calendar?action=auth');
    if (data.url) {
      window.location.href = data.url;
    } else {
      showToast('カレンダー連携URLを取得できませんでした');
    }
  } catch (e) {
    showToast(`エラー: ${e.message}`);
  }
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
