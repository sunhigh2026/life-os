// GET /api/photos/:key — R2から画像を取得して返すプロキシ
export async function onRequestGet({ params, env }) {
  const key = params.key;
  if (!key) {
    return new Response('Not Found', { status: 404 });
  }

  const object = await env.PHOTOS.get(key);
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
