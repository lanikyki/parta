import { getUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { body, fail, json } from '@/lib/http';

/** Настройки писем: о новых сообщениях и о подписке. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  const b = await body<{ notifyMessages: boolean; notifyBilling: boolean }>(req);
  if (typeof b.notifyMessages === 'boolean') await q('update users set notify_messages = $2 where id = $1', [user.id, b.notifyMessages]);
  if (typeof b.notifyBilling === 'boolean') await q('update users set notify_billing = $2 where id = $1', [user.id, b.notifyBilling]);
  return json({ ok: true });
}
