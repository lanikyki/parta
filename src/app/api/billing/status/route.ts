import { getUser } from '@/lib/auth';
import { syncPayment } from '@/lib/billing';
import { one } from '@/lib/db';
import { fail, json } from '@/lib/http';

/** Состояние платежа (страница «Подписка и баланс» спрашивает, пока банк подтверждает оплату). */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  const id = new URL(req.url).searchParams.get('id') || '';
  const p = await one<{ id: string }>('select id from payments where id = $1 and user_id = $2', [id, user.id]);
  if (!p) return fail('Платёж не найден', 404);
  const status = await syncPayment(p.id).catch(() => null);
  return json({ status });
}
