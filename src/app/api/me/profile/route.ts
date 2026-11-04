import { getUser } from '@/lib/auth';
import { cleanGrade } from '@/lib/brand';
import { q } from '@/lib/db';
import { body, fail, json, rateLimit, str } from '@/lib/http';

/** Имя, предметы и «о себе» (репетитор), класс (ученик). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  if (!rateLimit(`profile:${user.id}`, 60, 3600e3)) return fail('Слишком часто — попробуйте позже', 429);
  const b = await body<{ name: string; subjects: string; about: string; grade: string }>(req);
  const name = str(b.name, 60).replace(/\s+/g, ' ');
  if (name.length < 2) return fail('Введите имя');
  const subjects = str(b.subjects, 160).replace(/\s+/g, ' ') || null;
  const about = str(b.about, 600).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') || null;
  if (user.role === 'tutor') await q('update users set name = $2, subjects = $3, about = $4 where id = $1', [user.id, name, subjects, about]);
  else await q('update users set name = $2, grade = $3 where id = $1', [user.id, name, cleanGrade(b.grade) || null]);
  return json({ ok: true });
}
