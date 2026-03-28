// ==============================
// 設定
// ==============================
const AUTH_KEY = 'hidapia2026';

// ==============================
// 状態
// ==============================
let chatRecognition = null;
let isChatRecording = false;
// セッションID: ページロードごとに生成し、チャット履歴の文脈管理に使用
const SESSION_ID = crypto.randomUUID();

// ==============================
// メッセージ送信
// ==============================
async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  appendMessage('user', message);
  scrollToBottom();

  const thinkingId = appendMessage('ai', '…考え中…', true);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_KEY}`,
      },
      body: JSON.stringify({ message, session_id: SESSION_ID }),
    });

    const data = await res.json();
    removeMessage(thinkingId);

    if (!res.ok) {
      appendMessage('ai', `エラー: ${data.error || 'Unknown error'}${data.detail ? '\n(' + data.detail + ')' : ''}`);
    } else {
      appendMessage('ai', data.reply);
    }
  } catch (e) {
    removeMessage(thinkingId);
    appendMessage('ai', `通信エラー: ${e.message}`);
  }

  scrollToBottom();
}

function sendQuick(msg) {
  document.getElementById('chatInput').value = msg;
  sendMessage();
}

// ==============================
// DOM操作
// ==============================
let msgCounter = 0;

function appendMessage(role, text, isTemp = false) {
  const id = `msg-${++msgCounter}`;
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.id = id;
  // innerHTML で改行を <br> に変換（XSS防止のためエスケープ後）
  el.innerHTML = escHtml(text).replace(/\n/g, '<br>');
  if (isTemp) el.style.opacity = '0.5';
  document.getElementById('chatMessages').appendChild(el);
  return id;
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function removeMessage(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function scrollToBottom() {
  const el = document.getElementById('chatMessages');
  el.scrollTop = el.scrollHeight;
}

// ==============================
// 音声入力
// ==============================
function toggleChatVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    showToast('このブラウザは音声入力に対応していません');
    return;
  }
  if (isChatRecording) {
    chatRecognition.stop();
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  chatRecognition = new SR();
  chatRecognition.lang = 'ja-JP';
  chatRecognition.continuous = true;
  chatRecognition.interimResults = true;
  chatRecognition.onstart = () => {
    isChatRecording = true;
    document.getElementById('chatVoiceBtn').classList.add('recording');
  };
  chatRecognition.onresult = (e) => {
    let text = '';
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
    }
    document.getElementById('chatInput').value = text;
  };
  chatRecognition.onend = () => {
    isChatRecording = false;
    document.getElementById('chatVoiceBtn').classList.remove('recording');
    if (document.getElementById('chatInput').value.trim()) sendMessage();
  };
  chatRecognition.start();
}

// ==============================
// キャラ設定読み込み
// ==============================
async function initCharacter() {
  try {
    const res = await fetch('/api/settings?keys=char_name,char_icon,char_greeting', {
      headers: { 'Authorization': `Bearer ${AUTH_KEY}` },
    });
    if (!res.ok) return;
    const s = await res.json();

    if (s.char_name) {
      const nameEl = document.getElementById('chatHeaderName');
      if (nameEl) nameEl.textContent = s.char_name;
    }
    if (s.char_icon) {
      // フルボディ表示用imgを更新（耳切れなし）
      const piaImg = document.getElementById('chatPiaImg');
      if (piaImg) {
        piaImg.src = `/${s.char_icon}`;
        piaImg.onerror = () => { piaImg.src = '/pia-full-1.png'; };
      }
    }
    if (s.char_greeting) {
      const greetEl = document.getElementById('greetingMsg');
      if (greetEl) greetEl.innerHTML = s.char_greeting.replace(/\n/g, '<br>');
    }
  } catch (_) { /* 設定読み込み失敗は無視 */ }
}

document.addEventListener('DOMContentLoaded', () => {
  initCharacter();
  // ダッシュボードからの自動メッセージ
  const autoMsg = localStorage.getItem('chatAutoMsg');
  if (autoMsg) {
    localStorage.removeItem('chatAutoMsg');
    setTimeout(() => sendQuick(autoMsg), 500);
  }
});

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
