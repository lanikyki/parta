import crypto from 'node:crypto';
import { getUser } from '@/lib/auth';
import { one, q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { body, clientIp, fail, json, str } from '@/lib/http';
import { LOCKED_TEXT, REMOVED_TEXT, guestName, isRemoved, lessonByCode, whoIs } from '@/lib/lessons';
import { createToken, livekitConfigured, roomName } from '@/lib/livekit';
import { linkStudent } from '@/lib/messages';

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  if (!livekitConfigured())
    return fail('Видеосервер не настроен: укажите LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET', 503);
  const user = await getUser();
  const isHost = Boolean(user && user.id === lesson.owner_id);
  // Кто это: аккаунт или гость (метка гостя хранится в cookie) — чтобы репетитор мог удалить человека из урока
  const who = (await whoIs(user, true))!;
  if (!isHost) {
    if (await isRemoved(lesson.id, who)) return json({ error: REMOVED_TEXT, removed: true }, 403);
    if (lesson.locked) {
      const known = await one(
        `select 1 from lesson_people where lesson_id = $1 and who = $2
         union all select 1 from lesson_members where lesson_id = $1 and $3::text is not null and user_id = $3 limit 1`,
        [lesson.id, who, user?.id ?? null],
      );
      if (!known) return json({ error: LOCKED_TEXT, locked: true }, 403);
    }
  }
  const b = await body<{ name: string }>(req);
  const name = user?.name || guestName(str(b.name, 60), lesson.owner_name);
  const suffix = crypto.randomBytes(4).toString('hex');
  const identity = user ? `u-${user.id.slice(0, 8)}-${suffix}` : `g-${suffix}`;
  if (user && !isHost) {
    await q('insert into lesson_members (lesson_id, user_id) values ($1, $2) on conflict do nothing', [lesson.id, user.id]);
    // После урока ученик появится у репетитора в «Моих учениках» — можно будет переписываться
    if (user.role === 'student') await linkStudent(lesson.owner_id, user.id);
  }
  await q('insert into lesson_people (lesson_id, identity, who, name) values ($1, $2, $3, $4) on conflict do nothing', [
    lesson.id,
    identity,
    who,
    name,
  ]);
  logEvent('lesson_join', {
    user,
    actor: user ? undefined : `${name} (гость)`,
    detail: `${lesson.title} (${lesson.code})`,
    req,
    dedupe: `${user?.id || clientIp(req)}:${lesson.code}`,
  });
  const token = await createToken({ room: roomName(lesson.code), identity, name, isHost });
  return json({ token, url: process.env.LIVEKIT_PUBLIC_URL || process.env.LIVEKIT_URL, identity, name, isHost });
}
