// ============================================================
// Life OS → Google Sheets 定期エクスポート
// ============================================================
// 【スクリプトプロパティの設定】
//   GAS エディタ → プロジェクトの設定 → スクリプトプロパティ に以下を追加:
//     LIFE_OS_URL  = https://life-os-7pj.pages.dev
//     AUTH_KEY     = hidapia2026
//     SHEET_ID     = 1TJ6Q6tHzxz7fN4PxbMD7fWMVIW6eyoxKYiyeXKgz35w
//     FITNESS_STEPS_FOLDER_ID    = Google DriveのフォルダID（歩数CSV）
//     FITNESS_ACTIVITY_FOLDER_ID = Google DriveのフォルダID（アクティビティCSV）
//
// 【使い方】
//   1. スクリプトプロパティを設定（上記）
//   2. setupTrigger を一度だけ実行 → 毎日AM6:00に自動同期
//   3. 手動同期はメニュー「🗂 Life OS → 今すぐ同期」またはsyncAll実行
//   4. フィットネス連携: Health SyncがDriveに保存するCSVフォルダのIDを設定
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

  // Google Fit API 経由でフィットネスデータを同期（直近2日分）
  try {
    const fitnessResult = syncFitnessFromGoogleFit(config);
    results.push(fitnessResult);
  } catch (e) {
    results.push(`❌ フィットネス同期: ${e.message}`);
  }

  // Life OS のフィットネスデータをスプシにも書き出し
  try {
    const fitnessSheetResult = writeFitnessSheet(ss, config);
    results.push(fitnessSheetResult);
  } catch (e) {
    results.push(`❌ フィットネスシート: ${e.message}`);
  }

  writeLog(ss, results);
  Logger.log(results.join('\n'));
}

// ============================================================
// フィットネスデータをスプシに書き出し（Life OS API から取得）
// ============================================================
function writeFitnessSheet(ss, config) {
  const url = `${config.lifeOsUrl}/api/fitness?days=90`;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'Authorization': `Bearer ${config.authKey}` },
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    return `❌ フィットネスシート: API ${res.getResponseCode()}`;
  }

  const data = JSON.parse(res.getContentText());
  const rows = data.fitness || [];

  let sheet = ss.getSheetByName('フィットネス');
  if (!sheet) {
    sheet = ss.insertSheet('フィットネス');
  }
  sheet.clearContents();
  sheet.clearFormats();

  if (!rows.length) {
    sheet.getRange(1, 1).setValue('フィットネスデータなし');
    return '⏭ フィットネスシート: データなし';
  }

  // ヘッダー
  const headers = ['日付', '歩数', '運動時間(分)', '体重(kg)'];
  const dataRows = rows.map(r => [
    r.date,
    r.steps || '',
    r.active_minutes || '',
    r.weight || '',
  ]);

  const allRows = [headers, ...dataRows];
  sheet.getRange(1, 1, allRows.length, headers.length).setValues(allRows);

  // ヘッダー書式
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#48bb78')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // 交互背景色
  for (let i = 0; i < dataRows.length; i++) {
    sheet.getRange(i + 2, 1, 1, headers.length)
      .setBackground(i % 2 === 0 ? '#f0fff4' : '#ffffff');
  }

  // 数値列を右寄せ
  if (dataRows.length > 0) {
    sheet.getRange(2, 2, dataRows.length, 3).setHorizontalAlignment('right');
  }

  sheet.autoResizeColumns(1, headers.length);

  // フィルタ
  try { sheet.getFilter()?.remove(); } catch (_) {}
  sheet.getRange(1, 1, allRows.length, headers.length).createFilter();

  // 最終更新
  sheet.getRange(1, headers.length + 2)
    .setValue('最終更新: ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'))
    .setFontColor('#888888')
    .setFontSize(9);

  return `✅ フィットネスシート: ${rows.length}件`;
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

  // Resend で既に送信済みならスキップ
  if (data.emailSent) {
    Logger.log(`${type}レポートは Resend で送信済み`);
    return;
  }

  // API が生成した charset 付きリッチ HTML をそのまま使う（文字化け防止）
  const subject = data.emailSubject
    || `Life OS ${type === 'weekly' ? '週次' : '年間'}レポート (${data.period.from} 〜 ${data.period.to})`;
  const html = data.emailHtml;

  if (!html) {
    // yearly 等 emailHtml が無い場合は簡易 HTML を生成
    const stats = data.stats || {};
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F5FBF8;font-family:sans-serif;">
<div style="max-width:560px;margin:20px auto;background:#fff;border-radius:16px;padding:24px;">
  <h2 style="text-align:center;">Life OS ${type === 'yearly' ? '年間' : ''}レポート</h2>
  <p style="text-align:center;color:#888;">${data.periodLabel || ''}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <tr><td style="padding:8px;">記録数</td><td style="text-align:right;font-weight:bold;">${stats.entryCount || 0}件</td></tr>
    <tr><td style="padding:8px;">ToDo完了</td><td style="text-align:right;font-weight:bold;">${stats.todoCompleted || 0}件</td></tr>
    <tr><td style="padding:8px;">読了</td><td style="text-align:right;font-weight:bold;">${stats.booksFinished || 0}冊</td></tr>
  </table>
</div></body></html>`;
  }

  MailApp.sendEmail({
    to: reportEmail,
    subject: subject,
    htmlBody: html,
  });

  Logger.log(`${type}レポートを ${reportEmail} に送信しました`);
}

// ============================================================
// フィットネス: Google Drive CSV → Life OS に同期
// Health Sync が Drive にCSVを保存する場合に対応
// ============================================================
// 【スクリプトプロパティに追加】
//   FITNESS_STEPS_FOLDER_ID    = 12bQVY129OFhtMwoGvjb8E6pZFXcDTJ15
//   FITNESS_ACTIVITY_FOLDER_ID = 1-TVvesMBU1lmvaxYtAz_hIMakxtMwauR
// ============================================================

// Google Fit API 経由で Life OS にフィットネスデータを同期
function syncFitnessFromGoogleFit(config) {
  const url = `${config.lifeOsUrl}/api/fitness-sync?days=2`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { 'Authorization': `Bearer ${config.authKey}` },
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    return `❌ フィットネス同期: HTTP ${res.getResponseCode()} ${res.getContentText().slice(0, 100)}`;
  }

  const data = JSON.parse(res.getContentText());
  if (data.error) {
    return `❌ フィットネス同期: ${data.error}`;
  }

  let msg = `✅ フィットネス: ${data.synced}件同期（${data.period.from} 〜 ${data.period.to}）`;
  if (data.errors && data.errors.length) {
    msg += ` ⚠️ ${data.errors.join(', ')}`;
  }
  return msg;
}

// --- 以下は旧 Health Sync CSV 連携（非推奨） ---
function syncFitnessToLifeOS(ss, config) {
  const props = PropertiesService.getScriptProperties();
  const stepsFolderId    = props.getProperty('FITNESS_STEPS_FOLDER_ID');
  const activityFolderId = props.getProperty('FITNESS_ACTIVITY_FOLDER_ID');

  if (!stepsFolderId && !activityFolderId) {
    return '⏭ フィットネス: FITNESS_STEPS_FOLDER_ID / FITNESS_ACTIVITY_FOLDER_ID 未設定（スキップ）';
  }

  // 直近30日分だけ同期
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  // 日付ごとにデータを集約
  const byDate = {};

  // 歩数フォルダ読み取り
  if (stepsFolderId) {
    try {
      const stepsData = _readAllCsvFromFolder(stepsFolderId, cutoff);
      stepsData.forEach(row => {
        if (!byDate[row.date]) byDate[row.date] = {};
        if (row.steps)          byDate[row.date].steps = row.steps;
        if (row.weight)         byDate[row.date].weight = row.weight;
        if (row.active_minutes) byDate[row.date].active_minutes = row.active_minutes;
      });
    } catch (e) {
      Logger.log('歩数フォルダ読み取りエラー: ' + e.message);
    }
  }

  // アクティビティフォルダ読み取り
  if (activityFolderId) {
    try {
      const actData = _readAllCsvFromFolder(activityFolderId, cutoff);
      actData.forEach(row => {
        if (!byDate[row.date]) byDate[row.date] = {};
        if (row.steps)          byDate[row.date].steps = row.steps;
        if (row.weight)         byDate[row.date].weight = row.weight;
        if (row.active_minutes) byDate[row.date].active_minutes = row.active_minutes;
      });
    } catch (e) {
      Logger.log('アクティビティフォルダ読み取りエラー: ' + e.message);
    }
  }

  // Life OS に POST
  const dates = Object.keys(byDate);
  let synced = 0;

  for (const date of dates) {
    const d = byDate[date];
    const payload = { date };
    if (d.steps)          payload.steps = d.steps;
    if (d.active_minutes) payload.active_minutes = d.active_minutes;
    if (d.weight)         payload.weight = d.weight;

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

  return `✅ フィットネス同期: ${synced}件（${dates.length}日分のCSV読取）`;
}

// ============================================================
// Google Drive フォルダ内の全CSVを読み取り
// ============================================================
function _readAllCsvFromFolder(folderId, cutoff) {
  const folder = DriveApp.getFolderById(folderId);
  // MIMEタイプに依存せず全ファイル取得（Health SyncのCSVが text/plain 等になる場合がある）
  const files = folder.getFiles();
  const results = [];
  const oldFiles = []; // 削除対象

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName().toLowerCase();

    // CSVファイルのみ対象
    if (!name.endsWith('.csv')) continue;

    // 30日以上前のファイルは読み取らず削除対象に
    if (file.getLastUpdated() < cutoff) {
      oldFiles.push(file);
      continue;
    }

    try {
      const csv = file.getBlob().getDataAsString('UTF-8');
      const rows = _parseCsv(csv);
      results.push(...rows);
    } catch (e) {
      Logger.log(`CSV読取エラー (${file.getName()}): ${e.message}`);
    }
  }

  // 古いCSVをゴミ箱に移動
  for (const f of oldFiles) {
    try {
      f.setTrashed(true);
      Logger.log(`🗑 古いCSV削除: ${f.getName()}`);
    } catch (e) {
      Logger.log(`削除エラー (${f.getName()}): ${e.message}`);
    }
  }
  if (oldFiles.length > 0) {
    Logger.log(`🗑 古いCSV ${oldFiles.length}件をゴミ箱に移動`);
  }

  return results;
}

// ============================================================
// CSV パース（Health Sync 形式に柔軟対応）
// 分単位の細かいデータを日別に集計して返す
// ============================================================
function _parseCsv(csvText) {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));

  // カラム名マッピング（Health Sync の様々な形式に対応）
  const dateIdx   = headers.findIndex(h => h === 'date' || h === '日付' || h.includes('date'));
  const stepsIdx  = headers.findIndex(h => h === 'steps' || h === '歩数' || h.includes('step'));
  const weightIdx = headers.findIndex(h => h === 'weight' || h === '体重' || h.includes('weight'));

  // 運動時間: 「活動時間」(秒)、「運動時間」(分)、active/duration/minute
  const activeIdx    = headers.findIndex(h => h.includes('active') || h.includes('duration') || h === '運動時間' || h.includes('minute'));
  const activeSecIdx = headers.findIndex(h => h === '活動時間' || h === '経過時間');  // 秒単位のカラム
  const distIdx      = headers.findIndex(h => h.includes('距離') || h.includes('distance'));

  if (dateIdx < 0) return [];

  // 日別に集計（歩数=合計、体重=最新値、運動時間=合計）
  const byDay = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    if (!cols[dateIdx]) continue;

    // 日付パース: "2026.03.19 07:11:00" や "2026.03.19" → "2026-03-19"
    let dateStr = cols[dateIdx];
    dateStr = dateStr.replace(/\./g, '-').replace(/\//g, '-').slice(0, 10);
    if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

    if (!byDay[dateStr]) byDay[dateStr] = { steps: 0, active_minutes: 0, weight: null };

    if (stepsIdx >= 0 && cols[stepsIdx]) {
      const v = parseInt(cols[stepsIdx]);
      if (!isNaN(v) && v > 0) byDay[dateStr].steps += v;  // 合計
    }

    // 活動時間（秒） → 分に変換して加算
    if (activeSecIdx >= 0 && cols[activeSecIdx]) {
      const v = parseInt(cols[activeSecIdx]);
      if (!isNaN(v) && v > 0) byDay[dateStr].active_minutes += Math.round(v / 60);
    } else if (activeIdx >= 0 && cols[activeIdx]) {
      const v = parseInt(cols[activeIdx]);
      if (!isNaN(v) && v > 0) byDay[dateStr].active_minutes += v;
    }

    if (weightIdx >= 0 && cols[weightIdx]) {
      const v = parseFloat(cols[weightIdx]);
      if (!isNaN(v) && v > 0) byDay[dateStr].weight = v;  // 最新値で上書き
    }
  }

  // 集計結果を配列に変換
  const results = [];
  for (const [date, d] of Object.entries(byDay)) {
    const row = { date };
    if (d.steps > 0)          row.steps = d.steps;
    if (d.active_minutes > 0) row.active_minutes = d.active_minutes;
    if (d.weight)             row.weight = d.weight;
    results.push(row);
  }

  return results;
}

