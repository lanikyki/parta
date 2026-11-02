import { getUser } from '@/lib/auth';
import { one, q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { body, fail, json, rateLimit, str } from '@/lib/http';
import { lessonByCode } from '@/lib/lessons';
import { livekitConfigured, muteMicrophone, removeFromRoom, roomName } from '@/lib/livekit';

type Ctx = { params: Promise<{ code: string }> };

/** Управлять участниками может только репетитор этого урока. */
async function ownLesson(code: string) {
  const lesson = await lessonByCode(code);
  if (!lesson) return { error: fail('Урок не найден', 404) };
  const user = await getUser();
  if (!user || user.id !== lesson.owner_id) return { error: fail('Управлять участниками может только репетитор урока', 403) };
  return { lesson, user };
}

async function state(lessonId: string) {
  const lesson = await one<{ locked: boolean }>('select locked from lessons where id = $1', [lessonId]);
  const removed = await q<{ who: string; name: string; at: Date }>(
    'select who, name, created_at as at from lesson_bans where lesson_id = $1 order by created_at desc limit 100',
    [lessonId],
  );
  return { locked: Boolean(lesson?.locked), removed };
}

export async function GET(_req: Request, { params }: Ctx) {
  const own = await ownLesson((await params).code);
  if (own.error) return own.error;
  return json(await state(own.lesson.id));
}

/**
 * Действия репетитора: remove — удалить из урока (зайти снова с того же аккаунта или устройства нельзя),
 * restore — вернуть удалённого, mute — выключить микрофон, lock — закрыть или открыть вход для новых людей.
 */
export async function POST(req: Request, { params }: Ctx) {
  const own = await ownLesson((await params).code);
  if (own.error) return own.error;
  const { lesson, user } = own;
  if (!rateLimit(`people:${user.id}`, 120, 60e3)) return fail('Слишком часто, подождите минуту', 429);
  const b = await body<{ action: string; identity: string; who: string; locked: boolean }>(req);
  const room = roomName(lesson.code);
  const identity = str(b.identity, 80);

  if (b.action === 'lock') {
    await q('update lessons set locked = $2 where id = $1', [lesson.id, Boolean(b.locked)]);
    return json(await state(lesson.id));
  }

  if (b.action === 'restore') {
    await q('delete from lesson_bans where lesson_id = $1 and who = $2', [lesson.id, str(b.who, 100)]);
    return json(await state(lesson.id));
  }

  if (!identity) return fail('Не указан участник');
  if (!livekitConfigured()) return fail('Видеосервер не настроен', 503);

  if (b.action === 'mute') {
    try {
      await muteMicrophone(room, identity);
    } catch (e) {
      console.warn('[people] mute:', (e as Error).message);
      return fail('Не удалось выключить микрофон — возможно, участник уже вышел. Обновите список.', 502);
    }
    return json({ ok: true });
  }

  if (b.action === 'remove') {
    const person = await one<{ who: string; name: string }>('select who, name from lesson_people where lesson_id = $1 and identity = $2', [
      lesson.id,
      identity,
    ]);
    if (person?.who === `u:${lesson.owner_id}`) return fail('Себя удалить нельзя');
    // Запоминаем, кого удалили, и выводим из видеокомнаты все его подключения (например, с двух вкладок)
    let ids = [identity];
    if (person) {
      await q('insert into lesson_bans (lesson_id, who, name) values ($1, $2, $3) on conflict do nothing', [lesson.id, person.who, person.name]);
      ids = (await q<{ identity: string }>('select identity from lesson_people where lesson_id = $1 and who = $2', [lesson.id, person.who])).map(
        (r) => r.identity,
      );
    }
    try {
      await removeFromRoom(room, ids);
    } catch (e) {
      console.warn('[people] remove:', (e as Error).message);
      return fail('Не удалось удалить участника из видеокомнаты. Попробуйте ещё раз.', 502);
    }
    logEvent('lesson_kick', { user, detail: `${person?.name || identity} — ${lesson.title} (${lesson.code})`, req });
    return json(await state(lesson.id));
  }

  return fail('Неизвестное действие');
}
