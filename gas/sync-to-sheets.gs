// ============================================================
// Life OS → Google Sheets 定期エクスポート
// ============================================================
// 【スクリプトプロパティの設定】
//   GAS エディタ → プロジェクトの設定 → スクリプトプロパティ に以下を追加:
//     LIFE_OS_URL  = https://life-os-7pj.pages.dev
//     AUTH_KEY     = hidapia2026
//     SHEET_ID     = 1TJ6Q6tHzxz7fN4PxbMD7fWMVIW6eyoxKYiyeXKgz35w
//     FITNESS_SHEET_NAME = (任意) Health Syncが書き出すシート名
//
// 【使い方】
//   1. スクリプトプロパティを設定（上記）
//   2. setupTrigger を一度だけ実行 → 毎日AM6:00に自動同期
//   3. 手動同期はメニュー「🗂 Life OS → 今すぐ同期」またはsyncAll実行
//   4. フィットネス連携: Health Sync等でスプシにデータ出力 → FITNESS_SHEET_NAMEを設定
// ============================================================

// シート名の定義
const SHEET_NAMES = {
  entries: '日記',
  todos:   'ToDo',
  books:   '読書',
};

// 書き出すカラム（DBの実際の列名）
const COLUMNS = {
  entries: ['id', 'datetime', 'mood', 'tag', 'text', 'created_at'],
  todos:   ['id', 'text', 'tag', 'priority', 'status', 'due', 'done_at', 'created_at'],
  books:   ['id', 'datetime', 'isbn', 'title', 'author', 'cover_url',
            'medium', 'rating', 'status', 'note'],
};

// 日本語ヘッダー
const HEADER_JA = {
  id: 'ID', datetime: '日時', mood: '気分', tag: 'タグ', text: '内容',
  created_at: '作成日時', priority: '優先度', status: 'ステータス',
  due: '期限', done_at: '完了日時', isbn: 'ISBN', title: 'タイトル',
  author: '著者', cover_url: 'カバーURL', medium: '媒体',
  rating: '評価', note: 'メモ・感想',
};

// ============================================================
// 設定をスクリプトプロパティから読み込む
// ============================================================
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const lifeOsUrl = props.getProperty('LIFE_OS_URL');
  const authKey   = props.getProperty('AUTH_KEY');
  const sheetId   = props.getProperty('SHEET_ID');

  if (!lifeOsUrl || !authKey) {
    throw new Error('スクリプトプロパティに LIFE_OS_URL と AUTH_KEY を設定してください');
  }

  return { lifeOsUrl, authKey, sheetId };
}

// ============================================================
// メイン: 全テーブルを同期
// ============================================================
function syncAll() {
  const config = getConfig();

  // SHEET_ID があればそのスプシを開く、なければアクティブを使う
  const ss = config.sheetId
    ? SpreadsheetApp.openById(config.sheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  const results = [];

  ['entries', 'todos', 'books'].forEach(table => {
    try {
      const data = fetchTable(table, config);
      writeSheet(ss, table, data);
      results.push(`✅ ${SHEET_NAMES[table]}: ${data.length}件`);
    } catch (e) {
      results.push(`❌ ${SHEET_NAMES[table]}: ${e.message}`);
    }
  });

  // フィットネスデータをスプシ → Life OS にアップロード
  try {
    const fitnessResult = syncFitnessToLifeOS(ss, config);
    results.push(fitnessResult);
  } catch (e) {
    results.push(`❌ フィットネス同期: ${e.message}`);
  }

  writeLog(ss, results);
  Logger.log(results.join('\n'));
}

// ============================================================
// API からデータ取得
// ============================================================
function fetchTable(table, config) {
  const url = `${config.lifeOsUrl}/api/export?table=${table}&format=json&limit=10000`;
  const options = {
    method: 'get',
    headers: { 'Authorization': `Bearer ${config.authKey}` },
    muteHttpExceptions: true,
  };

  const res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() !== 200) {
    throw new Error(`HTTP ${res.getResponseCode()}: ${res.getContentText().slice(0, 200)}`);
  }

  return JSON.parse(res.getContentText()).data || [];
}

// ============================================================
// シートへ書き込み（全件上書き）
// ============================================================
function writeSheet(ss, table, data) {
  const sheetName = SHEET_NAMES[table];

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  sheet.clearContents();
  sheet.clearFormats();

  if (!data.length) {
    sheet.getRange(1, 1).setValue(`${sheetName}データなし`);
    return;
  }

  const cols      = COLUMNS[table];
  const headerRow = cols.map(c => HEADER_JA[c] || c);
  const dataRows  = data.map(row => cols.map(c => row[c] ?? ''));

  // ヘッダー + データを一括書き込み
  const allRows = [headerRow, ...dataRows];
  sheet.getRange(1, 1, allRows.length, cols.length).setValues(allRows);

  // ヘッダー書式
  sheet.getRange(1, 1, 1, cols.length)
    .setBackground('#4a90e2')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // 行の交互背景色
  for (let i = 0; i < dataRows.length; i++) {
    sheet.getRange(i + 2, 1, 1, cols.length)
      .setBackground(i % 2 === 0 ? '#f8f9ff' : '#ffffff');
  }

  // 列幅自動調整
  sheet.autoResizeColumns(1, cols.length);

  // フィルタ設定（既存フィルタがあれば削除してから再設定）
  try { sheet.getFilter()?.remove(); } catch (_) {}
  sheet.getRange(1, 1, allRows.length, cols.length).createFilter();

  // 最終更新時刻を右端に
  sheet.getRange(1, cols.length + 2)
    .setValue('最終更新: ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'))
    .setFontColor('#888888')
    .setFontSize(9);
}

// ============================================================
// 同期ログをシートに記録
// ============================================================
function writeLog(ss, results) {
  let logSheet = ss.getSheetByName('同期ログ');
  if (!logSheet) {
    logSheet = ss.insertSheet('同期ログ');
    logSheet.getRange(1, 1, 1, 3)
      .setValues([['実行日時', '結果', '詳細']])
      .setBackground('#555555')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
  }

  const now     = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  const ok      = results.filter(r => r.startsWith('✅')).length;
  const ng      = results.filter(r => r.startsWith('❌')).length;
  const summary = `成功${ok}件 / 失敗${ng}件`;

  logSheet.appendRow([now, summary, results.join(' | ')]);

  // ログは最新100行まで保持
  const lastRow = logSheet.getLastRow();
  if (lastRow > 101) {
    logSheet.deleteRows(2, lastRow - 101);
  }
}

// ============================================================
// 定期実行トリガーの設定（初回のみ手動実行）
// ============================================================
function setupTrigger() {
  // 既存の syncAll トリガーを削除
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncAll')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 毎日 AM 6:00 に実行
  ScriptApp.newTrigger('syncAll')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();

  Logger.log('トリガー設定完了: 毎日 AM6:00 に Life OS データを自動同期します。');
}

// ============================================================
// 週次レポートトリガー設定（毎週日曜AM9:00）
// ============================================================
function setupWeeklyReportTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendWeeklyReport')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(9)
    .create();

  Logger.log('週次レポートトリガー設定完了: 毎週日曜 AM9:00');
}

// ============================================================
// 週次レポート: Life OS API → メール送信
// ============================================================
function sendWeeklyReport() {
  _sendReport('weekly');
}

function sendYearlyReport() {
  _sendReport('yearly');
}

function _sendReport(type) {
  const config = getConfig();
  const props = PropertiesService.getScriptProperties();
  const reportEmail = props.getProperty('REPORT_EMAIL') || Session.getActiveUser().getEmail();

  const url = `${config.lifeOsUrl}/api/report?type=${type}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'Authorization': `Bearer ${config.authKey}` },
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    Logger.log(`レポート取得失敗: ${res.getResponseCode()} ${res.getContentText().slice(0, 200)}`);
    return;
  }

  const data = JSON.parse(res.getContentText());
  const subject = type === 'weekly'
    ? `Life OS 週次レポート (${data.period.from} 〜 ${data.period.to})`
    : `Life OS 年間レポート (${data.period.from} 〜 ${data.period.to})`;

  // HTMLメールを構築
  const stats = data.stats;
  const comment = data.comment || '';
  const moodEmoji = stats.avgMood ? (stats.avgMood >= 4 ? '😊' : stats.avgMood >= 3 ? '🙂' : '😐') : '➖';

  const html = `
<div style="max-width:560px;margin:20px auto;font-family:sans-serif;">
  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;border-radius:16px 16px 0 0;text-align:center;color:#fff;">
    <div style="font-size:32px;">📊</div>
    <h2 style="margin:8px 0 0;">${type === 'weekly' ? '週次レポート' : '年間レポート'}</h2>
    <p style="margin:4px 0 0;opacity:0.85;font-size:13px;">${data.period.from} 〜 ${data.period.to}</p>
  </div>
  <div style="background:#fff;padding:20px;border:1px solid #e5e7eb;border-top:none;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px;">📝 記録数</td><td style="padding:8px;font-weight:bold;text-align:right;">${stats.entryCount}件</td></tr>
      <tr style="background:#f9fafb;"><td style="padding:8px;">${moodEmoji} 平均気分</td><td style="padding:8px;font-weight:bold;text-align:right;">${stats.avgMood || '—'}/6</td></tr>
      <tr><td style="padding:8px;">✅ タスク完了</td><td style="padding:8px;font-weight:bold;text-align:right;">${stats.todoCompleted}件</td></tr>
      <tr style="background:#f9fafb;"><td style="padding:8px;">📋 残タスク</td><td style="padding:8px;font-weight:bold;text-align:right;">${stats.todoRemaining}件</td></tr>
      <tr><td style="padding:8px;">⚠️ 期限切れ</td><td style="padding:8px;font-weight:bold;text-align:right;">${stats.todoOverdue}件</td></tr>
      <tr style="background:#f9fafb;"><td style="padding:8px;">📚 読了</td><td style="padding:8px;font-weight:bold;text-align:right;">${stats.booksFinished}冊</td></tr>
      <tr><td style="padding:8px;">🚶 平均歩数</td><td style="padding:8px;font-weight:bold;text-align:right;">${stats.avgSteps ? stats.avgSteps.toLocaleString() + '歩' : '—'}</td></tr>
      <tr style="background:#f9fafb;"><td style="padding:8px;">⚖️ 平均体重</td><td style="padding:8px;font-weight:bold;text-align:right;">${stats.avgWeight ? stats.avgWeight + 'kg' : '—'}</td></tr>
    </table>
    <div style="background:#fef3c7;border-radius:12px;padding:16px;margin-top:16px;">
      <div style="font-weight:bold;color:#92400e;margin-bottom:6px;">🧸 ピアちゃんのコメント</div>
      <p style="margin:0;color:#78350f;line-height:1.7;font-size:14px;">${comment}</p>
    </div>
  </div>
  <div style="text-align:center;padding:12px;color:#9ca3af;font-size:11px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;">
    Life OS — あなたの毎日をサポート
  </div>
</div>`;

  MailApp.sendEmail({
    to: reportEmail,
    subject: subject,
    htmlBody: html,
  });

  Logger.log(`${type}レポートを ${reportEmail} に送信しました`);
}

// ============================================================
// フィットネス: スプシ → Life OS に同期
// Health Sync等がスプシに書き出したデータを読み取りPOST
// ============================================================
function syncFitnessToLifeOS(ss, config) {
  const props = PropertiesService.getScriptProperties();
  const fitnessSheetName = props.getProperty('FITNESS_SHEET_NAME');
  if (!fitnessSheetName) return '⏭ フィットネス: FITNESS_SHEET_NAME未設定（スキップ）';

  const sheet = ss.getSheetByName(fitnessSheetName);
  if (!sheet) return `⏭ フィットネス: シート「${fitnessSheetName}」が見つかりません`;

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return '⏭ フィットネス: データなし';

  const headers = data[0].map(h => String(h).trim().toLowerCase());
  const dateIdx = headers.findIndex(h => h === 'date' || h === '日付');
  const stepsIdx = headers.findIndex(h => h === 'steps' || h === '歩数');
  const activeIdx = headers.findIndex(h => h.includes('active') || h === '運動時間');
  const weightIdx = headers.findIndex(h => h === 'weight' || h === '体重');

  if (dateIdx < 0) return '❌ フィットネス: date/日付カラムが見つかりません';

  // 直近30日分だけ同期
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  let synced = 0;

  for (let i = 1; i < data.length; i++) {
    const rawDate = data[i][dateIdx];
    if (!rawDate) continue;

    let dateStr;
    if (rawDate instanceof Date) {
      dateStr = Utilities.formatDate(rawDate, 'Asia/Tokyo', 'yyyy-MM-dd');
    } else {
      dateStr = String(rawDate).trim();
      if (!dateStr.match(/^\d{4}-\d{2}-\d{2}/)) continue;
      dateStr = dateStr.slice(0, 10);
    }

    if (new Date(dateStr) < cutoff) continue;

    const payload = { date: dateStr };
    if (stepsIdx >= 0 && data[i][stepsIdx]) payload.steps = parseInt(data[i][stepsIdx]) || null;
    if (activeIdx >= 0 && data[i][activeIdx]) payload.active_minutes = parseInt(data[i][activeIdx]) || null;
    if (weightIdx >= 0 && data[i][weightIdx]) payload.weight = parseFloat(data[i][weightIdx]) || null;

    if (!payload.steps && !payload.active_minutes && !payload.weight) continue;

    try {
      UrlFetchApp.fetch(`${config.lifeOsUrl}/api/fitness`, {
        method: 'post',
        headers: { 'Authorization': `Bearer ${config.authKey}`, 'Content-Type': 'application/json' },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
      synced++;
    } catch (_) {}
  }

  return `✅ フィットネス同期: ${synced}件`;
}

