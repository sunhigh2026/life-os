// ============================================================
// Life OS → Google Sheets 定期エクスポート
// ============================================================
// 【スクリプトプロパティの設定】
//   GAS エディタ → プロジェクトの設定 → スクリプトプロパティ に以下を追加:
//     LIFE_OS_URL  = https://life-os-7pj.pages.dev
//     AUTH_KEY     = hidapia2026
//     SHEET_ID     = 1TJ6Q6tHzxz7fN4PxbMD7fWMVIW6eyoxKYiyeXKgz35w
//
// 【使い方】
//   1. スクリプトプロパティを設定（上記）
//   2. setupTrigger を一度だけ実行 → 毎日AM6:00に自動同期
//   3. 手動同期はメニュー「🗂 Life OS → 今すぐ同期」またはsyncAll実行
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

  SpreadsheetApp.getUi().alert(
    'トリガー設定完了',
    '毎日 AM6:00 に Life OS データを自動同期します。\n\n今すぐ同期する場合はメニュー「🗂 Life OS → 今すぐ同期」を実行してください。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ============================================================
// スプレッドシートを開いたときにカスタムメニューを追加
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🗂 Life OS')
    .addItem('今すぐ同期', 'syncAll')
    .addSeparator()
    .addItem('⏰ 定期トリガー設定（初回のみ）', 'setupTrigger')
    .addToUi();
}
