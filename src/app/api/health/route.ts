import crypto from 'node:crypto';
import { aiConfigured } from '@/lib/ai';
import { db } from '@/lib/db';
import { clientIp, rateLimit } from '@/lib/http';
import { livekitConfigured } from '@/lib/livekit';
import { shareUrl } from '@/lib/share';

export async function GET(req: Request) {
  // ?probe=1 — 256 КБ случайных байтов: скрипт ссылки для друга так проверяет, проходят ли через ссылку
  // большие страницы (случайные данные не сжимаются, поэтому проверка честная)
  if (new URL(req.url).searchParams.has('probe')) {
    if (!rateLimit(`probe:${clientIp(req)}`, 30, 60000)) return new Response('Too many requests', { status: 429 });
    return new Response(crypto.randomBytes(256 * 1024), {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store, no-transform' },
    });
  }
  let database = 'ok';
  try {
    await (await db()).query('select 1');
  } catch {
    database = 'error';
  }
  const publicUrl = shareUrl();
  return Response.json(
    {
      database,
      storage: process.env.DATABASE_URL ? 'postgres' : 'local',
      video: livekitConfigured(),
      ai: aiConfigured(),
      dev: process.env.NODE_ENV !== 'production', // запущен режим разработки (start-windows) — его не стоит показывать по ссылке
      ...(publicUrl ? { publicUrl } : {}), // открыта ссылка для друга — кнопки «Скопировать ссылку» берут её
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
