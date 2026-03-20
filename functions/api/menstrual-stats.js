function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/menstrual-stats — 生理周期の自動検出・予測
export async function onRequestGet({ env }) {
  // 日記テキストから生理開始を示す特定キーワードのみ抽出
  // 「生理始まった」「生理開始」「生理きた」「生理来た」「生理なった」にマッチ
  // 「GoogleFitに生理管理ある」等の無関係な言及は除外
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT substr(datetime, 1, 10) as date
     FROM entries
     WHERE (
       text LIKE '%生理始%'
       OR text LIKE '%生理開始%'
       OR text LIKE '%生理きた%'
       OR text LIKE '%生理来た%'
       OR text LIKE '%生理なった%'
       OR text LIKE '%生理だ%'
       OR text LIKE '%#生理%'
     )
     ORDER BY date ASC`
  ).all();

  if (!results.length) {
    return json({ detected: false, message: '生理に関する日記がまだありません' });
  }

  // 連続する日付をグループ化して「開始日」だけを抽出
  const startDates = [];
  let prevDate = null;

  for (const row of results) {
    const d = new Date(row.date);
    if (!prevDate || (d - prevDate) > 3 * 24 * 60 * 60 * 1000) {
      // 3日以上離れていたら新しい周期の開始とみなす
      startDates.push(row.date);
    }
    prevDate = d;
  }

  if (startDates.length < 2) {
    return json({
      detected: true,
      startDates,
      cycles: [],
      avgCycle: null,
      nextPrediction: null,
      message: `記録${startDates.length}回。予測には2回以上の記録が必要です`,
    });
  }

  // 周期（日数）を算出
  const cycles = [];
  for (let i = 1; i < startDates.length; i++) {
    const prev = new Date(startDates[i - 1]);
    const curr = new Date(startDates[i]);
    const days = Math.round((curr - prev) / (24 * 60 * 60 * 1000));
    if (days >= 15 && days <= 60) { // 異常値除外
      cycles.push(days);
    }
  }

  if (!cycles.length) {
    return json({
      detected: true,
      startDates,
      cycles: [],
      avgCycle: null,
      nextPrediction: null,
      message: '周期の算出ができませんでした',
    });
  }

  // 中央値で平均周期を算出（外れ値に強い）
  const sorted = [...cycles].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  const avgCycle = Math.round(median);

  // 次回予測日
  const lastStart = new Date(startDates[startDates.length - 1]);
  const nextDate = new Date(lastStart);
  nextDate.setDate(nextDate.getDate() + avgCycle);
  const nextPrediction = nextDate.toISOString().slice(0, 10);

  // 今日との差分
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = Math.round((nextDate - today) / (24 * 60 * 60 * 1000));

  return json({
    detected: true,
    startDates,
    cycles,
    avgCycle,
    nextPrediction,
    daysUntil,
    message: daysUntil > 0
      ? `次回予測: ${nextPrediction}（あと${daysUntil}日）`
      : daysUntil === 0
        ? '今日が予測日です'
        : `予測日を${Math.abs(daysUntil)}日過ぎています`,
  });
}
