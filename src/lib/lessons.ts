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
