function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/entry-photo?id=xxx  — 写真アップロード
export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'id required' }, 400);

    if (!env.PHOTOS) return json({ error: 'R2 PHOTOS binding not configured' }, 500);

    // エントリ存在確認
    const entry = await env.DB.prepare('SELECT id, photo_url FROM entries WHERE id = ?').bind(id).first();
    if (!entry) return json({ error: 'entry not found' }, 404);

    // multipart/form-data から画像取得
    const formData = await request.formData();
    const file = formData.get('photo');
    if (!file) return json({ error: 'photo file required' }, 400);

    // 既存写真があればR2から削除
    if (entry.photo_url) {
      await env.PHOTOS.delete(entry.photo_url);
    }

    // R2にアップロード
    const key = `${id}_${Date.now()}.webp`;
    await env.PHOTOS.put(key, file.stream(), {
      httpMetadata: { contentType: 'image/webp' },
    });

    // DB更新
    await env.DB.prepare('UPDATE entries SET photo_url = ? WHERE id = ?').bind(key, id).run();

    return json({ photo_url: key }, 201);
  } catch (e) {
    return json({ error: e.message || 'upload failed' }, 500);
  }
}

// DELETE /api/entry-photo?id=xxx  — 写真削除
export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);

  const entry = await env.DB.prepare('SELECT id, photo_url FROM entries WHERE id = ?').bind(id).first();
  if (!entry) return json({ error: 'entry not found' }, 404);
  if (!entry.photo_url) return json({ error: 'no photo to delete' }, 404);

  // R2から削除
  await env.PHOTOS.delete(entry.photo_url);

  // DB更新
  await env.DB.prepare('UPDATE entries SET photo_url = NULL WHERE id = ?').bind(id).run();

  return json({ id, deleted: true });
}
