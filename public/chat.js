// ==============================
// 設定
// ==============================
const AUTH_KEY = 'hidapia2026';

// ==============================
// 状態
// ==============================
let chatRecognition = null;
let isChatRecording = false;

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
      body: JSON.stringify({ message }),
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
  el.textContent = text;
  if (isTemp) el.style.opacity = '0.5';
  document.getElementById('chatMessages').appendChild(el);
  return id;
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
  chatRecognition.onstart = () => {
    isChatRecording = true;
    document.getElementById('chatVoiceBtn').classList.add('recording');
  };
  chatRecognition.onresult = (e) => {
    document.getElementById('chatInput').value += e.results[0][0].transcript;
  };
  chatRecognition.onend = () => {
    isChatRecording = false;
    document.getElementById('chatVoiceBtn').classList.remove('recording');
    sendMessage();
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
      const iconEl = document.getElementById('chatHeaderIcon');
      if (iconEl) {
        iconEl.innerHTML = `<img src="/${s.char_icon}" alt="" onerror="this.parentElement.textContent='🩷'">`;
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
