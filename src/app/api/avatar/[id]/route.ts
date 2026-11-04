import { one } from '@/lib/db';

/** Фото профиля. Адрес с ?v= не меняется, пока фото то же — браузер хранит его у себя. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const row = await one<{ mime: string; data: Uint8Array }>('select mime, data from avatars where user_id = $1', [id]);
  if (!row) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const versioned = new URL(req.url).searchParams.has('v');
  return new Response(new Uint8Array(row.data), {
    headers: {
      'content-type': row.mime,
      'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
