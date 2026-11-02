import { getUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { body, fail, json, rateLimit, str } from '@/lib/http';
import { uid } from '@/lib/ids';
import { clientIp, guestName, lessonByCode, removedResponse } from '@/lib/lessons';

type Ctx = { params: Promise<{ code: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  const removed = await removedResponse(lesson.id, await getUser(), lesson.owner_id);
  if (removed) return removed;
  const rows = await q(
    'select * from (select id, author, text, created_at from chat_messages where lesson_id = $1 order by created_at desc limit 300) m order by created_at asc',
    [lesson.id],
  );
  return json(rows);
}

export async function POST(req: Request, { params }: Ctx) {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  if (!rateLimit(`chat:${clientIp(req)}`, 120, 60e3)) return fail('Слишком часто', 429);
  const user = await getUser();
  const removed = await removedResponse(lesson.id, user, lesson.owner_id);
  if (removed) return removed;
  const b = await body<{ id: string; author: string; text: string }>(req);
  const text = str(b.text, 4000);
  if (!text) return fail('Пустое сообщение');
  const id = typeof b.id === 'string' && /^[a-z0-9-]{8,40}$/i.test(b.id) ? b.id : uid();
  await q('insert into chat_messages (id, lesson_id, author, text) values ($1, $2, $3, $4) on conflict (id) do nothing', [
    id,
    lesson.id,
    user?.name || guestName(str(b.author, 60), lesson.owner_name),
    text,
  ]);
  return json({ ok: true, id });
}
