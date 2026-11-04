// Приём оплаты. Настоящая касса — ЮKassa (YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY).
// Пока кассы нет, на своём компьютере (и с TEST_MODE=1 на сервере) работает тестовая оплата: деньги не списываются,
// а страница «Тестовая оплата» позволяет нажать «Оплатить» или «Отменить» — так можно проверить все сценарии.

export type ProviderName = 'yookassa' | 'test';
export type RemoteMethod = { id: string; saved: boolean; title: string; fp: string | null };
export type Remote = { status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled'; method: RemoteMethod | null; reason?: string };

const env = (k: string) => (process.env[k] || '').trim().replace(/^["']|["']$/g, '');

export const yookassaConfigured = () => Boolean(env('YOOKASSA_SHOP_ID') && env('YOOKASSA_SECRET_KEY'));
export const paymentsTestMode = () => !yookassaConfigured() && (process.env.NODE_ENV !== 'production' || process.env.TEST_MODE === '1');

/** Через что принимаем оплату сейчас. null — оплата не подключена (на сервере без кассы и без TEST_MODE). */
export const paymentProvider = (): ProviderName | null => (yookassaConfigured() ? 'yookassa' : paymentsTestMode() ? 'test' : null);

/**
 * Автопродление: списание с сохранённой карты. В ЮKassa его включают по заявке (автоплатежи),
 * после этого впишите YOOKASSA_RECURRING=1. В тестовом режиме работает всегда.
 */
export const recurringEnabled = () => (yookassaConfigured() ? env('YOOKASSA_RECURRING') === '1' : paymentsTestMode());

const value = (kop: number) => (kop / 100).toFixed(2);

async function yk<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; idem?: string } = {}): Promise<T> {
  const base = (env('YOOKASSA_API_URL') || 'https://api.yookassa.ru/v3').replace(/\/+$/, '');
  const auth = Buffer.from(`${env('YOOKASSA_SHOP_ID')}:${env('YOOKASSA_SECRET_KEY')}`).toString('base64');
  const res = await fetch(`${base}${path}`, {
    method: init.method || 'GET',
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/json',
      ...(init.idem ? { 'idempotence-key': init.idem } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(25_000),
  });
  const j = (await res.json().catch(() => ({}))) as T & { description?: string; code?: string };
  if (!res.ok) throw new Error(`ЮKassa ${res.status}: ${j.description || j.code || 'ошибка'}`);
  return j;
}

type YkMethod = { id?: string; saved?: boolean; title?: string; type?: string; card?: { first6?: string; last4?: string; expiry_month?: string; expiry_year?: string } };
type YkPayment = {
  id: string;
  status: Remote['status'];
  confirmation?: { confirmation_url?: string };
  payment_method?: YkMethod;
  cancellation_details?: { reason?: string };
};

function method(pm: YkMethod | undefined): RemoteMethod | null {
  if (!pm?.id) return null;
  const c = pm.card;
  const title = c?.last4 ? `Карта •••• ${c.last4}` : pm.type === 'sbp' ? 'СБП' : pm.title || 'Способ оплаты';
  return { id: pm.id, saved: Boolean(pm.saved), title, fp: c?.last4 ? `${c.first6 ?? ''}${c.last4}${c.expiry_month ?? ''}${c.expiry_year ?? ''}` : null };
}

const toRemote = (p: YkPayment): Remote => ({ status: p.status, method: method(p.payment_method), reason: p.cancellation_details?.reason });

/** Чек по 54-ФЗ. Нужен, если в ЮKassa подключены «Чеки от ЮKassa» или своя онлайн-касса (YOOKASSA_RECEIPTS=1). */
function receipt(email: string, description: string, amount: number) {
  if (env('YOOKASSA_RECEIPTS') !== '1') return undefined;
  const tax = Number(env('YOOKASSA_TAX_SYSTEM'));
  return {
    customer: { email },
    items: [
      {
        description: description.slice(0, 128),
        quantity: '1.00',
        amount: { value: value(amount), currency: 'RUB' },
        vat_code: Number(env('YOOKASSA_VAT_CODE')) || 1,
        payment_mode: 'full_payment',
        payment_subject: 'service',
      },
    ],
    ...(tax ? { tax_system_code: tax } : {}),
  };
}

type NewPayment = { id: string; amount: number; description: string; returnUrl: string; email: string; save: boolean };

/** Создаёт платёж. url — страница оплаты, куда отправить человека. */
export async function createRemote(provider: ProviderName, p: NewPayment): Promise<{ providerId: string; url: string }> {
  if (provider === 'test') {
    // Тестовая «касса» — наша же страница; после оплаты она вернёт человека туда же, куда вернула бы ЮKassa
    let back = '/billing';
    try {
      const u = new URL(p.returnUrl);
      back = u.pathname + u.search;
    } catch {}
    return { providerId: `test_${p.id}`, url: `/pay/test/${p.id}?return=${encodeURIComponent(back)}` };
  }
  const r = await yk<YkPayment>('/payments', {
    method: 'POST',
    idem: p.id,
    body: {
      amount: { value: value(p.amount), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: p.returnUrl },
      description: p.description.slice(0, 128),
      metadata: { payment_id: p.id },
      ...(p.save ? { save_payment_method: true } : {}),
      ...(receipt(p.email, p.description, p.amount) ? { receipt: receipt(p.email, p.description, p.amount) } : {}),
    },
  });
  const url = r.confirmation?.confirmation_url;
  if (!url) throw new Error('ЮKassa не прислала ссылку на оплату');
  return { providerId: r.id, url };
}

/** Состояние платежа в кассе. В тестовом режиме касса — наша же база, поэтому null. */
export async function fetchRemote(provider: string, providerId: string): Promise<Remote | null> {
  if (provider !== 'yookassa') return null;
  return toRemote(await yk<YkPayment>(`/payments/${encodeURIComponent(providerId)}`));
}

/** Списание с сохранённой карты (автопродление). */
export async function chargeSaved(provider: ProviderName, p: Omit<NewPayment, 'returnUrl' | 'save'> & { methodId: string }): Promise<{ providerId: string; remote: Remote }> {
  if (provider === 'test') {
    // В тестовом режиме «карта» с номером, оканчивающимся на 0000, отказывает — чтобы проверить неудачное списание
    const fail = p.methodId.endsWith('0000');
    return { providerId: `test_${p.id}`, remote: { status: fail ? 'canceled' : 'succeeded', method: { id: p.methodId, saved: true, title: 'Тестовая карта', fp: null }, reason: fail ? 'card_expired' : undefined } };
  }
  const r = await yk<YkPayment>('/payments', {
    method: 'POST',
    idem: p.id,
    body: {
      amount: { value: value(p.amount), currency: 'RUB' },
      capture: true,
      payment_method_id: p.methodId,
      description: p.description.slice(0, 128),
      metadata: { payment_id: p.id },
      ...(receipt(p.email, p.description, p.amount) ? { receipt: receipt(p.email, p.description, p.amount) } : {}),
    },
  });
  return { providerId: r.id, remote: toRemote(r) };
}

/** Возврат денег. */
export async function refundRemote(provider: string, providerId: string, amount: number, idem: string): Promise<{ id: string; status: 'succeeded' | 'pending' | 'canceled' }> {
  if (provider === 'test') return { id: `test_${idem}`, status: 'succeeded' };
  if (provider !== 'yookassa') throw new Error('Этот платёж нельзя вернуть через кассу');
  const r = await yk<{ id: string; status: 'succeeded' | 'pending' | 'canceled' }>('/refunds', {
    method: 'POST',
    idem,
    body: { payment_id: providerId, amount: { value: value(amount), currency: 'RUB' } },
  });
  return { id: r.id, status: r.status };
}

/** Возврат, сделанный в личном кабинете ЮKassa (приходит уведомлением). */
export async function fetchRefund(refundId: string) {
  const r = await yk<{ payment_id: string; status: string; amount?: { value?: string } }>(`/refunds/${encodeURIComponent(refundId)}`);
  return { paymentId: r.payment_id, status: r.status, amount: Math.round(Number(r.amount?.value || 0) * 100) };
}

/** Причина отмены платежа понятными словами. */
export function cancelText(reason?: string | null) {
  const map: Record<string, string> = {
    insufficient_funds: 'недостаточно денег на карте',
    card_expired: 'истёк срок действия карты',
    expired_on_confirmation: 'время на оплату истекло',
    canceled_by_merchant: 'платёж отменён',
    permission_revoked: 'автоплатежи для карты отключены',
    payment_method_restricted: 'банк ограничил оплату этой картой',
    fraud_suspected: 'банк заподозрил мошенничество',
    '3d_secure_failed': 'не пройдено подтверждение банка',
    call_issuer: 'банк отклонил оплату — позвоните в банк',
    general_decline: 'банк отклонил оплату',
    by_user: 'вы отменили оплату',
  };
  return (reason && map[reason]) || '';
}
