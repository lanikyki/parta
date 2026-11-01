import { getUser } from '@/lib/auth';
import { SUBJECTS } from '@/lib/brand';
import { q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { body, fail, json, str } from '@/lib/http';
import { lessonCode, uid } from '@/lib/ids';

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  if (user.role !== 'tutor') return fail('Создавать уроки могут репетиторы', 403);
  const b = await body<{ title: string; subject: string; kind: string; startsAt: string; durationMin: number }>(req);
  const title = str(b.title, 120) || 'Урок';
  // Предмет — из подсказок или свой (например, «Гитара» или «Подготовка к IELTS»)
  const raw = str(b.subject, 40).replace(/\s+/g, ' ');
  const subject = SUBJECTS.find((s) => s.toLowerCase() === raw.toLowerCase()) ?? (raw ? raw[0].toUpperCase() + raw.slice(1) : null);
  const kind = b.kind === 'group' ? 'group' : 'individual';
  const startsAt = b.startsAt && !Number.isNaN(Date.parse(b.startsAt)) ? new Date(b.startsAt) : null;
  const duration = Math.min(240, Math.max(15, Math.round(Number(b.durationMin) || 60)));
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = lessonCode();
    try {
      await q(
        `insert into lessons (id, code, title, subject, kind, starts_at, duration_min, owner_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [uid(), code, title, subject, kind, startsAt, duration, user.id],
      );
      logEvent('lesson_create', { user, detail: `${title} (${code})`, req });
      return json({ code });
    } catch (e) {
      if (!String((e as Error).message).includes('unique')) throw e;
    }
  }
  return fail('Не удалось создать урок, попробуйте ещё раз', 500);
}
