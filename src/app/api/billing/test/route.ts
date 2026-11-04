import { getUser } from '@/lib/auth';
import { applyPayment, cancelPayment, type PaymentRow } from '@/lib/billing';
import { one } from '@/lib/db';
import { body, fail, json } from '@/lib/http';
import { paymentsTestMode } from '@/lib/payments';

/**
 * Тестовая оплата (пока касса не подключена): { id, action: 'pay' | 'cancel', card }.
 * card: 4242 и 1111 — оплата проходит; 0000 — оплата проходит, а автопродление потом не сработает; fail — банк отказал.
 */
export async function POST(req: Request) {
  if (!paymentsTestMode()) return fail('Тестовая оплата выключена', 404);
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  const b = await body<{ id: string; action: string; card: string }>(req);
  const p = await one<PaymentRow>("select * from payments where id = $1 and user_id = $2 and provider = 'test'", [String(b.id || ''), user.id]);
  if (!p) return fail('Платёж не найден', 404);
  if (p.status !== 'pending') return json({ status: p.status });
  if (b.action === 'cancel') {
    await cancelPayment(p.id, 'by_user');
    return json({ status: 'canceled' });
  }
  if (b.card === 'fail') {
    await cancelPayment(p.id, 'insufficient_funds');
    return json({ status: 'canceled' });
  }
  const last4 = ['4242', '1111', '0000'].includes(String(b.card)) ? String(b.card) : '4242';
  await applyPayment(p.id, { status: 'succeeded', method: { id: `test_card_${last4}`, saved: p.save_card, title: `Тестовая карта •••• ${last4}`, fp: `test${last4}` } });
  return json({ status: 'succeeded' });
}
