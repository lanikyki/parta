import { getUser } from '@/lib/auth';
import { setAutorenew } from '@/lib/billing';
import { body, fail, json } from '@/lib/http';

/** Автопродление: { on: false } — выключить (и забыть карту), { on: true } — включить снова, если карта сохранена. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  const b = await body<{ on: boolean }>(req);
  const ok = await setAutorenew(user.id, b.on === true);
  if (!ok) return fail('Включить автопродление можно после оплаты картой');
  return json({ ok: true });
}
