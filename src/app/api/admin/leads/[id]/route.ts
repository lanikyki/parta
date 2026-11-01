import { isAdmin } from '@/lib/admin';
import { getUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { body, fail, json } from '@/lib/http';

/** Админ отмечает обращение обработанным (или снимает отметку). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!isAdmin(user)) return fail('Нет доступа', 404);
  const { id } = await params;
  const b = await body<{ done: boolean }>(req);
  await q('update leads set done_at = $2 where id = $1', [id, b.done ? new Date() : null]);
  return json({ ok: true });
}
