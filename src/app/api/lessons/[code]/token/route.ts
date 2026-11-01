import crypto from 'node:crypto';
import { getUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { body, clientIp, fail, json, str } from '@/lib/http';
import { lessonByCode } from '@/lib/lessons';
import { createToken, livekitConfigured } from '@/lib/livekit';
import { linkStudent } from '@/lib/messages';

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  if (!livekitConfigured())
    return fail('Видеосервер не настроен: укажите LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET', 503);
  const user = await getUser();
  const b = await body<{ name: string }>(req);
  const name = user?.name || str(b.name, 60) || 'Гость';
  const isHost = Boolean(user && user.id === lesson.owner_id);
  const suffix = crypto.randomBytes(4).toString('hex');
  const identity = user ? `u-${user.id.slice(0, 8)}-${suffix}` : `g-${suffix}`;
  if (user && !isHost) {
    await q('insert into lesson_members (lesson_id, user_id) values ($1, $2) on conflict do nothing', [lesson.id, user.id]);
    // После урока ученик появится у репетитора в «Моих учениках» — можно будет переписываться
    if (user.role === 'student') await linkStudent(lesson.owner_id, user.id);
  }
  logEvent('lesson_join', {
    user,
    actor: user ? undefined : `${name} (гость)`,
    detail: `${lesson.title} (${lesson.code})`,
    req,
    dedupe: `${user?.id || clientIp(req)}:${lesson.code}`,
  });
  const token = await createToken({ room: `lesson-${lesson.code}`, identity, name, isHost });
  return json({ token, url: process.env.LIVEKIT_PUBLIC_URL || process.env.LIVEKIT_URL, identity, name, isHost });
}
