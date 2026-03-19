// ============================================================
// Life OS → Google Sheets 定期同期スクリプト
// ============================================================
// 設定: スクリプトプロパティ（ファイル > プロジェクトのプロパティ > スクリプトのプロパティ）に設定
//   LIFE_OS_URL  : https://your-project.pages.dev
//   AUTH_KEY     : あなたのAPIキー
//   SHEET_ID     : 書き込み先スプレッドシートのID（URLの /d/XXXXX/edit の部分）
// ============================================================

const PROPS = PropertiesService.getScriptProperties();
const BASE_URL = PROPS.getProperty('LIFE_OS_URL');
const AUTH_KEY = PROPS.getProperty('AUTH_KEY');
const SHEET_ID = PROPS.getProperty('SHEET_ID');

function syncAll() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  syncTable(ss, 'entries');
  syncTable(ss, 'todos');
  syncTable(ss, 'books');
  Logger.log('同期完了: ' + new Date().toLocaleString('ja-JP'));
}

function syncTable(ss, table) {
  const url = `${BASE_URL}/api/export?table=${table}&format=json&limit=10000`;
  const res = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${AUTH_KEY}` },
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    Logger.log(`[${table}] エラー: ${res.getResponseCode()} ${res.getContentText()}`);
    return;
  }

  const { data } = JSON.parse(res.getContentText());
  if (!data || data.length === 0) {
    Logger.log(`[${table}] データなし`);
    return;
  }

  // シートを取得または作成
  let sheet = ss.getSheetByName(table);
  if (!sheet) {
    sheet = ss.insertSheet(table);
  } else {
    sheet.clearContents();
  }

  // ヘッダー行
  const headers = Object.keys(data[0]);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#e8f0fe');

  // データ行
  const rows = data.map(row => headers.map(h => {
    const v = row[h];
    return v === null || v === undefined ? '' : v;
  }));
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

  // 列幅を自動調整
  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }

  Logger.log(`[${table}] ${data.length}件 書き込み完了`);
}

// 手動実行用: 初回セットアップ確認
function checkSetup() {
  if (!BASE_URL || !AUTH_KEY || !SHEET_ID) {
    throw new Error('スクリプトプロパティが未設定です。LIFE_OS_URL / AUTH_KEY / SHEET_ID を設定してください。');
  }
  Logger.log('設定OK: ' + BASE_URL);
}
