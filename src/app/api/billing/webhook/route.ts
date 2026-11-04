import { markRefunded, syncPayment } from '@/lib/billing';
import { one, q } from '@/lib/db';
import { body, json } from '@/lib/http';
import { fetchRefund, yookassaConfigured } from '@/lib/payments';

/**
 * Уведомления ЮKassa (в личном кабинете ЮKassa: Интеграция → HTTP-уведомления → https://ваш-домен/api/billing/webhook,
 * события payment.succeeded, payment.canceled, refund.succeeded).
 * Тексту уведомления не верим: по номеру платежа сами спрашиваем у ЮKassa, что с ним.
 */
export async function POST(req: Request) {
  if (!yookassaConfigured()) return json({ ok: true });
  const b = await body<{ event: string; object: { id?: string; metadata?: { payment_id?: string } } }>(req);
  const event = String(b.event || '');
  const obj = b.object || {};
  const remoteId = String(obj.id || '').slice(0, 100);
  if (!remoteId) return json({ ok: true });
  try {
    if (event.startsWith('payment.')) {
      let row = await one<{ id: string }>("select id from payments where provider = 'yookassa' and provider_id = $1", [remoteId]);
      const own = String(obj.metadata?.payment_id || '');
      if (!row && /^[0-9a-f-]{36}$/.test(own)) {
        // Уведомление пришло раньше, чем мы записали номер платежа в кассе
        await q("update payments set provider_id = $2 where id = $1 and provider = 'yookassa' and provider_id is null", [own, remoteId]);
        row = await one<{ id: string }>("select id from payments where id = $1 and provider = 'yookassa' and provider_id = $2", [own, remoteId]);
      }
      if (row) await syncPayment(row.id);
    } else if (event.startsWith('refund.')) {
      const r = await fetchRefund(remoteId);
      if (r.status === 'succeeded') {
        const row = await one<{ id: string }>("select id from payments where provider = 'yookassa' and provider_id = $1", [r.paymentId]);
        if (row) await markRefunded(row.id, r.amount, remoteId);
      }
    }
    return json({ ok: true });
  } catch (e) {
    // Ответ не 200 — ЮKassa повторит уведомление позже
    console.error('[Оплата] уведомление ЮKassa не обработано:', (e as Error).message);
    return json({ error: 'retry' }, 500);
  }
}
