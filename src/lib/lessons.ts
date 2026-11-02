import { guestId, type User } from './auth';
import { one } from './db';
import { isLessonCode } from './ids';

export type Lesson = {
  id: string;
  code: string;
  title: string;
  subject: string | null;
  kind: 'individual' | 'group';
  starts_at: Date | null;
  duration_min: number;
  owner_id: string;
  owner_name: string;
  summary: string | null;
  summary_at: Date | null;
  locked: boolean;
  created_at: Date;
};

export async function lessonByCode(code: string) {
  if (!isLessonCode(code)) return null;
  return one<Lesson>(
    `select l.*, u.name as owner_name from lessons l join users u on u.id = l.owner_id where l.code = $1`,
    [code],
  );
}

export { clientIp } from './http';

// Латинские буквы, похожие на русские: «Аннa» с латинской «a» не должна обойти проверку
const LOOKALIKE: Record<string, string> = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', ё: 'е', й: 'и' };
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[a-zё]/g, (c) => LOOKALIKE[c] ?? c)
    .replace(/[^a-zа-я0-9]/g, '');

/** Имя гостя в уроке. Назваться как репетитор урока нельзя — иначе легко выдать себя за него в чате и на видео. */
export function guestName(raw: string, ownerName: string) {
  const name = raw.replace(/\s+/g, ' ').trim() || 'Гость';
  return norm(name) && norm(name) === norm(ownerName) ? `${name} (гость)` : name;
}

/** Кто это для урока: «u:…» — пользователь с аккаунтом, «g:…» — гость (метка в cookie). null — гость без метки. */
export async function whoIs(user: Pick<User, 'id'> | null, create = false) {
  if (user) return `u:${user.id}`;
  const g = await guestId(create);
  return g ? `g:${g}` : null;
}

export const REMOVED_TEXT = 'Репетитор удалил вас из этого урока. Если это ошибка, напишите ему — он может вернуть вас.';

export const LOCKED_TEXT = 'Репетитор закрыл вход в этот урок. Напишите ему — он может открыть вход, тогда обновите страницу.';

/** Удалил ли репетитор этого человека из урока. */
export async function isRemoved(lessonId: string, who: string | null) {
  if (!who) return false;
  return Boolean(await one('select 1 from lesson_bans where lesson_id = $1 and who = $2', [lessonId, who]));
}

/** Отвечает 403, если репетитор удалил этого человека из урока (для чата, доски и картинок). */
export async function removedResponse(lessonId: string, user: Pick<User, 'id'> | null, ownerId: string) {
  if (user?.id === ownerId) return null;
  if (!(await isRemoved(lessonId, await whoIs(user)))) return null;
  return Response.json({ error: REMOVED_TEXT, removed: true }, { status: 403 });
}
