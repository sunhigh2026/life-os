// ============================================================
// Life OS → Google Sheets 定期エクスポート
// ============================================================
// 使い方:
//   1. スプレッドシート → 拡張機能 → Apps Script を開く
//   2. このコードを貼り付けて保存
//   3. LIFE_OS_URL を自分の Cloudflare Pages URL に変更
//   4. 「setupTrigger」を一度だけ実行してトリガーを設定
//   5. 以降は毎日 AM6:00 に自動同期されます
// ============================================================

const LIFE_OS_URL = 'https://life-os.pages.dev'; // ★ご自分のURL に変更
const AUTH_KEY    = 'hidapia2026';                // ★変更した場合は合わせる

// シート名の定義
const SHEET_NAMES = {
  entries: '日記',
  todos:   'ToDo',
  books:   '読書',
};

// 書き出すカラムの定義（DBの全列）
const COLUMNS = {
  entries: ['id', 'datetime', 'mood', 'tag', 'text', 'created_at'],
  todos:   ['id', 'text', 'tag', 'priority', 'status', 'due', 'done_at', 'created_at'],
  books:   ['id', 'isbn', 'title', 'author', 'publisher', 'published_date',
            'status', 'rating', 'start_date', 'end_date', 'memo', 'cover_url', 'created_at'],
};

// カラムの日本語ヘッダー
const HEADER_JA = {
  id: 'ID', datetime: '日時', mood: '気分', tag: 'タグ', text: '内容', created_at: '作成日時',
  text_todo: 'タスク', priority: '優先度', status: 'ステータス', due: '期限', done_at: '完了日時',
  isbn: 'ISBN', title: 'タイトル', author: '著者', publisher: '出版社',
  published_date: '出版年', rating: '評価', start_date: '読み始め',
  end_date: '読み終わり', memo: 'メモ', cover_url: 'カバー画像URL',
};

// ============================================================
// メイン: 全テーブルを同期
// ============================================================
function syncAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const results = [];

  ['entries', 'todos', 'books'].forEach(table => {
    try {
      const data = fetchTable(table);
      writeSheet(ss, table, data);
      results.push(`✅ ${SHEET_NAMES[table]}: ${data.length}件`);
    } catch (e) {
      results.push(`❌ ${SHEET_NAMES[table]}: ${e.message}`);
    }
  });

  // 「ログ」シートに同期履歴を記録
  writeLog(ss, results);
  Logger.log(results.join('\n'));
}

// ============================================================
// API からデータ取得
// ============================================================
function fetchTable(table) {
  const url = `${LIFE_OS_URL}/api/export?table=${table}&format=json&limit=10000`;
  const options = {
    method: 'get',
    headers: { 'Authorization': `Bearer ${AUTH_KEY}` },
    muteHttpExceptions: true,
  };

  const res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() !== 200) {
    throw new Error(`HTTP ${res.getResponseCode()}: ${res.getContentText().slice(0, 200)}`);
  }

  const json = JSON.parse(res.getContentText());
  return json.data || [];
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

  const cols = COLUMNS[table];
  const headerRow = cols.map(c => HEADER_JA[c] || c);
  const dataRows  = data.map(row => cols.map(c => row[c] ?? ''));

  // ヘッダー + データを一括書き込み
  const allRows = [headerRow, ...dataRows];
  sheet.getRange(1, 1, allRows.length, cols.length).setValues(allRows);

  // ヘッダー書式
  const headerRange = sheet.getRange(1, 1, 1, cols.length);
  headerRange
    .setBackground('#4a90e2')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // 行の交互背景色
  if (dataRows.length > 0) {
    for (let i = 0; i < dataRows.length; i++) {
      const color = i % 2 === 0 ? '#f8f9ff' : '#ffffff';
      sheet.getRange(i + 2, 1, 1, cols.length).setBackground(color);
    }
  }

  // 列幅自動調整
  sheet.autoResizeColumns(1, cols.length);

  // フィルタを設定
  sheet.getRange(1, 1, allRows.length, cols.length).createFilter();

  // 最終更新を右上セルに
  const updateCell = sheet.getRange(1, cols.length + 2);
  updateCell
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

  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  const ok   = results.filter(r => r.startsWith('✅')).length;
  const ng   = results.filter(r => r.startsWith('❌')).length;
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
  // 既存のトリガーを全削除
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncAll') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 毎日 AM 6:00 に実行
  ScriptApp.newTrigger('syncAll')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();

  SpreadsheetApp.getUi().alert(
    'トリガー設定完了',
    '毎日 AM6:00 に Life OS データを自動同期します。\n\n今すぐ同期する場合は syncAll を実行してください。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ============================================================
// カスタムメニューをスプレッドシートに追加
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🗂 Life OS')
    .addItem('今すぐ同期', 'syncAll')
    .addSeparator()
    .addItem('⏰ 定期トリガー設定（初回のみ）', 'setupTrigger')
    .addToUi();
}
