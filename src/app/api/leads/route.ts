import { cleanGrade } from '@/lib/brand';
import { q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { body, clientIp, fail, json, rateLimit, str } from '@/lib/http';
import { uid } from '@/lib/ids';

/** Вопрос с сайта (форма внизу главной). Видно в админке → «Обращения». */
export async function POST(req: Request) {
  if (!rateLimit(`lead:${clientIp(req)}`, 8, 3600e3)) return fail('Вы уже отправили несколько вопросов — мы скоро ответим', 429);
  const b = await body<{ name: string; contact: string; grade: string; subject: string; comment: string }>(req);
  const name = str(b.name, 60);
  const contact = str(b.contact, 80);
  const comment = str(b.comment, 1000);
  if (name.length < 2) return fail('Как к вам обращаться?');
  if (contact.length < 5) return fail('Оставьте почту, телефон или Telegram');
  // Класс и предмет — из старой формы заявки; новая форма их не отправляет.
  const grade = cleanGrade(b.grade);
  const subject = str(b.subject, 40);
  await q('insert into leads (id, name, contact, grade, subject, comment) values ($1, $2, $3, $4, $5, $6)', [
    uid(),
    name,
    contact,
    grade || null,
    subject || null,
    comment || null,
  ]);
  logEvent('lead', { actor: name, req });
  return json({ ok: true });
}
