function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function jstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

async function gatherStats(db, from, to) {
  const entries = await db.prepare(
    `SELECT COUNT(*) as count, AVG(mood) as avgMood FROM entries WHERE datetime >= ? AND datetime < ?`
  ).bind(from, to).first();

  const todoDone = await db.prepare(
    `SELECT COUNT(*) as count FROM todos WHERE status = 'done' AND done_at >= ? AND done_at < ?`
  ).bind(from, to).first();

  const todoRemaining = await db.prepare(
    `SELECT COUNT(*) as count FROM todos WHERE status != 'done'`
  ).first();

  const todoOverdue = await db.prepare(
    `SELECT COUNT(*) as count FROM todos WHERE status != 'done' AND due < ? AND due IS NOT NULL`
  ).bind(to).first();

  const booksFinished = await db.prepare(
    `SELECT COUNT(*) as count FROM books WHERE status = 'done' AND datetime >= ? AND datetime < ?`
  ).bind(from, to).first();

  const fitness = await db.prepare(
    `SELECT AVG(steps) as avgSteps, AVG(active_minutes) as avgActive, AVG(weight) as avgWeight FROM fitness WHERE date >= ? AND date < ?`
  ).bind(from, to).first();

  return {
    entryCount: entries.count || 0,
    avgMood: entries.avgMood ? Math.round(entries.avgMood * 10) / 10 : null,
    todoCompleted: todoDone.count || 0,
    todoRemaining: todoRemaining.count || 0,
    todoOverdue: todoOverdue.count || 0,
    booksFinished: booksFinished.count || 0,
    avgSteps: fitness.avgSteps ? Math.round(fitness.avgSteps) : null,
    avgActiveMinutes: fitness.avgActive ? Math.round(fitness.avgActive) : null,
    avgWeight: fitness.avgWeight ? Math.round(fitness.avgWeight * 10) / 10 : null,
  };
}

async function generateComment(apiKey, stats, type) {
  const period = type === 'weekly' ? '1週間' : '1年間';
  const prompt = type === 'weekly'
    ? `あなたはピアちゃん。以下の1週間の統計を見て、ユーザーに向けた温かい振り返りコメントを200字以内で書いてください。口調は「〜だよ」「〜だね」「〜かも！」`
    : `あなたはピアちゃん。以下の1年間の統計を見て、ユーザーに向けた温かい年間振り返りコメントを300字以内で書いてください。口調は「〜だよ」「〜だね」「〜かも！」`;

  const statsText = `
${period}の統計:
- 記録数: ${stats.entryCount}件
- 平均気分: ${stats.avgMood ?? '記録なし'}/5
- タスク完了: ${stats.todoCompleted}件 / 残り: ${stats.todoRemaining}件 / 期限切れ: ${stats.todoOverdue}件
- 読了した本: ${stats.booksFinished}冊
- 平均歩数: ${stats.avgSteps ?? '記録なし'}歩
- 平均アクティブ時間: ${stats.avgActiveMinutes ?? '記録なし'}分
- 平均体重: ${stats.avgWeight ?? '記録なし'}kg
  `.trim();

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}\n\n${statsText}` }] }],
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'コメントを生成できませんでした。';
}

function buildEmailHtml(stats, comment, type, periodLabel) {
  const title = type === 'weekly' ? 'Life OS 週次レポート' : 'Life OS 年間レポート';

  const moodEmoji = stats.avgMood
    ? stats.avgMood >= 4 ? '😊' : stats.avgMood >= 3 ? '🙂' : stats.avgMood >= 2 ? '😐' : '😢'
    : '➖';

  const card = (emoji, label, value) => `
    <div style="background:#f8f9fa;border-radius:12px;padding:16px 20px;text-align:center;min-width:120px;flex:1;">
      <div style="font-size:28px;margin-bottom:4px;">${emoji}</div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:4px;">${label}</div>
      <div style="font-size:22px;font-weight:700;color:#1f2937;">${value}</div>
    </div>
  `;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 24px;text-align:center;">
      <div style="font-size:36px;margin-bottom:8px;">📊</div>
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${title}</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">${periodLabel}</p>
    </div>

    <div style="padding:24px;">
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px;">
        ${card('📝', '記録数', `${stats.entryCount}件`)}
        ${card(moodEmoji, '平均気分', stats.avgMood ? `${stats.avgMood}/5` : '—')}
        ${card('✅', 'タスク完了', `${stats.todoCompleted}件`)}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px;">
        ${card('📋', '残タスク', `${stats.todoRemaining}件`)}
        ${card('⚠️', '期限切れ', `${stats.todoOverdue}件`)}
        ${card('📚', '読了', `${stats.booksFinished}冊`)}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px;">
        ${card('🚶', '平均歩数', stats.avgSteps ? `${stats.avgSteps.toLocaleString()}歩` : '—')}
        ${card('⏱️', 'アクティブ', stats.avgActiveMinutes ? `${stats.avgActiveMinutes}分` : '—')}
        ${card('⚖️', '平均体重', stats.avgWeight ? `${stats.avgWeight}kg` : '—')}
      </div>

      <div style="background:#fef3c7;border-radius:12px;padding:20px;margin-top:8px;">
        <div style="font-size:16px;font-weight:600;color:#92400e;margin-bottom:8px;">🧸 ピアちゃんのコメント</div>
        <p style="margin:0;color:#78350f;font-size:14px;line-height:1.7;">${comment}</p>
      </div>
    </div>

    <div style="padding:16px 24px;text-align:center;color:#9ca3af;font-size:12px;border-top:1px solid #f3f4f6;">
      Life OS — あなたの毎日をサポート
    </div>
  </div>
</body>
</html>
  `.trim();
}

async function sendEmail(env, subject, html) {
  if (!env.RESEND_API_KEY || !env.REPORT_EMAIL) return false;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Life OS <noreply@resend.dev>',
        to: env.REPORT_EMAIL,
        subject,
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const type = url.searchParams.get('type');

  if (!type || !['weekly', 'yearly'].includes(type)) {
    return json({ error: 'type must be "weekly" or "yearly"' }, 400);
  }

  const jst = jstNow();
  let from, to, periodLabel, emailSubject;

  if (type === 'weekly') {
    const toDate = new Date(jst);
    const fromDate = new Date(jst);
    fromDate.setDate(fromDate.getDate() - 7);
    from = formatDate(fromDate);
    to = formatDate(toDate);
    periodLabel = `${from} 〜 ${to}`;
    emailSubject = `Life OS 週次レポート (${periodLabel})`;
  } else {
    const toDate = new Date(jst);
    const fromDate = new Date(jst);
    fromDate.setFullYear(fromDate.getFullYear() - 1);
    from = formatDate(fromDate);
    to = formatDate(toDate);
    periodLabel = `${from} 〜 ${to}`;
    emailSubject = `Life OS 年間レポート (${periodLabel})`;
  }

  try {
    const stats = await gatherStats(env.DB, from, to);

    let comment = '';
    try {
      comment = await generateComment(env.GEMINI_API_KEY, stats, type);
    } catch (e) {
      comment = 'コメントの生成に失敗しました。';
      console.error('Gemini error:', e.message);
    }

    const html = buildEmailHtml(stats, comment, type, periodLabel);
    const emailSent = await sendEmail(env, emailSubject, html);

    return json({ stats, comment, emailSent, period: { from, to } });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
