import { getUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { fail, json } from '@/lib/http';
import { lessonByCode } from '@/lib/lessons';

type Ctx = { params: Promise<{ code: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  return json({ code: lesson.code, title: lesson.title, subject: lesson.subject, tutor: lesson.owner_name });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const user = await getUser();
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  if (!user || user.id !== lesson.owner_id) return fail('Удалить урок может только его репетитор', 403);
  await q('delete from lessons where id = $1', [lesson.id]);
  logEvent('lesson_delete', { user, detail: `${lesson.title} (${lesson.code})`, req });
  return json({ ok: true });
}
