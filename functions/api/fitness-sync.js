function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ==============================
// OAuth トークン取得（calendar.js と共通ロジック）
// ==============================
async function getValidAccessToken(env) {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN ('gcal_access_token','gcal_refresh_token','gcal_token_expires')`
  ).all();
  const m = {};
  results.forEach(r => { m[r.key] = r.value; });
  if (!m.gcal_access_token || !m.gcal_refresh_token) return null;
  if (m.gcal_token_expires && Date.now() < Number(m.gcal_token_expires)) return m.gcal_access_token;

  // リフレッシュ
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: m.gcal_refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  const expiresAt = Date.now() + (d.expires_in - 60) * 1000;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('gcal_access_token',?)`).bind(d.access_token),
    env.DB.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('gcal_token_expires',?)`).bind(String(expiresAt)),
  ]);
  return d.access_token;
}

// ==============================
// JST 日付ヘルパー
// ==============================
function jstToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateToJstMillis(dateStr, endOfDay = false) {
  // dateStr = "YYYY-MM-DD" → JST 00:00:00 or 23:59:59 のミリ秒
  const t = new Date(dateStr + 'T00:00:00+09:00').getTime();
  return endOfDay ? t + 86400000 - 1 : t;
}

// ==============================
// Google Fit API: 歩数・アクティビティ・カロリー
// ==============================
async function fetchActivityData(token, startDate, endDate) {
  const res = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      aggregateBy: [
        { dataTypeName: 'com.google.step_count.delta' },
        { dataTypeName: 'com.google.active_minutes' },
        { dataTypeName: 'com.google.calories.expended' },
      ],
      bucketByTime: { durationMillis: 86400000 },
      startTimeMillis: dateToJstMillis(startDate),
      endTimeMillis: dateToJstMillis(endDate, true),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Activity API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const byDate = {};

  for (const bucket of (data.bucket || [])) {
    const date = new Date(Number(bucket.startTimeMillis) + 9 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    if (!byDate[date]) byDate[date] = { steps: 0, active_minutes: 0, calories: 0 };

    for (const ds of (bucket.dataset || [])) {
      for (const pt of (ds.point || [])) {
        const typeName = pt.dataTypeName || ds.dataSourceId || '';
        for (const val of (pt.value || [])) {
          if (typeName.includes('step_count')) {
            byDate[date].steps += val.intVal || 0;
          } else if (typeName.includes('active_minutes')) {
            byDate[date].active_minutes += val.intVal || 0;
          } else if (typeName.includes('calories')) {
            byDate[date].calories += Math.floor(val.fpVal || 0);
          }
        }
      }
    }
  }

  return { byDate, raw: data };
}

// ==============================
// Google Fit API: 体重
// ==============================
async function fetchWeightData(token, startDate, endDate) {
  const res = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      aggregateBy: [
        { dataTypeName: 'com.google.weight' },
      ],
      bucketByTime: { durationMillis: 86400000 },
      startTimeMillis: dateToJstMillis(startDate),
      endTimeMillis: dateToJstMillis(endDate, true),
    }),
  });

  if (!res.ok) return {};

  const data = await res.json();
  const byDate = {};

  for (const bucket of (data.bucket || [])) {
    const date = new Date(Number(bucket.startTimeMillis) + 9 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    for (const ds of (bucket.dataset || [])) {
      for (const pt of (ds.point || [])) {
        for (const val of (pt.value || [])) {
          if (val.fpVal) {
            byDate[date] = Math.round(val.fpVal * 10) / 10; // kg, 小数1桁
          }
        }
      }
    }
  }

  return byDate;
}

// ==============================
// Google Fit API: 睡眠
// ==============================
async function fetchSleepData(token, startDate, endDate) {
  const startTime = new Date(startDate + 'T00:00:00+09:00').toISOString();
  const endTime = new Date(endDate + 'T23:59:59+09:00').toISOString();

  const params = new URLSearchParams({
    startTime,
    endTime,
    activityType: '72', // 睡眠
  });

  const res = await fetch(
    `https://www.googleapis.com/fitness/v1/users/me/sessions?${params}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  if (!res.ok) return {};

  const data = await res.json();
  const byDate = {};

  for (const session of (data.session || [])) {
    const startMs = Number(session.startTimeMillis);
    const endMs = Number(session.endTimeMillis);
    const minutes = Math.round((endMs - startMs) / 60000);

    // 睡眠の「終了日」をその日の睡眠とする（朝起きた日）
    const endDate = new Date(endMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    byDate[endDate] = (byDate[endDate] || 0) + minutes;
  }

  return byDate;
}

// ==============================
// POST /api/fitness/sync — Google Fit から同期
// ==============================
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const days = Math.min(90, parseInt(url.searchParams.get('days') || '7', 10));

  const token = await getValidAccessToken(env);
  if (!token) {
    return json({ error: 'Google認証が必要です。設定画面から再認証してください。', needsAuth: true }, 401);
  }

  const today = jstToday();
  const startD = new Date(today + 'T00:00:00+09:00');
  startD.setDate(startD.getDate() - days + 1);
  const startDate = startD.toISOString().slice(0, 10);

  let activityResult, weightResult, sleepResult;
  const errors = [];

  // 並行でAPI呼び出し
  try {
    [activityResult, weightResult, sleepResult] = await Promise.all([
      fetchActivityData(token, startDate, today).catch(e => { errors.push(`activity: ${e.message}`); return { byDate: {}, raw: null }; }),
      fetchWeightData(token, startDate, today).catch(e => { errors.push(`weight: ${e.message}`); return {}; }),
      fetchSleepData(token, startDate, today).catch(e => { errors.push(`sleep: ${e.message}`); return {}; }),
    ]);
  } catch (e) {
    return json({ error: e.message }, 500);
  }

  const activityByDate = activityResult.byDate || {};
  const syncedAt = new Date().toISOString();
  let synced = 0;

  // 日別にUPSERT
  const allDates = new Set([
    ...Object.keys(activityByDate),
    ...Object.keys(weightResult),
    ...Object.keys(sleepResult),
  ]);

  for (const date of allDates) {
    const activity = activityByDate[date] || {};
    const weight = weightResult[date] || null;
    const sleepMin = sleepResult[date] || null;

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO fitness (id, date, steps, active_minutes, calories, weight, sleep_minutes, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         steps = COALESCE(excluded.steps, fitness.steps),
         active_minutes = COALESCE(excluded.active_minutes, fitness.active_minutes),
         calories = COALESCE(excluded.calories, fitness.calories),
         weight = COALESCE(excluded.weight, fitness.weight),
         sleep_minutes = COALESCE(excluded.sleep_minutes, fitness.sleep_minutes),
         synced_at = excluded.synced_at`
    ).bind(
      id, date,
      activity.steps || null,
      activity.active_minutes || null,
      activity.calories || null,
      weight,
      sleepMin,
      syncedAt,
    ).run();

    synced++;
  }

  return json({
    synced,
    period: { from: startDate, to: today },
    errors: errors.length ? errors : undefined,
  });
}
