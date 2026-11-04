import { getUser } from '@/lib/auth';
import { logEvent } from '@/lib/events';
import { body, clientIp, fail, json, rateLimit, str } from '@/lib/http';
import { checkCall, fmtPhone, normPhone, requestCall } from '@/lib/phone';

/**
 * Подтверждение телефона звонком.
 * { action: 'call', phone } — позвонить; { action: 'check', code } — проверить 4 последние цифры номера, с которого звонили.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  const b = await body<{ action: string; phone: string; code: string }>(req);
  if (b.action === 'call') {
    const phone = normPhone(b.phone);
    if (!phone) return fail('Нужен российский мобильный номер: +7 9XX XXX-XX-XX');
    const r = await requestCall(user.id, phone, clientIp(req));
    if (!r.ok) return json({ error: r.error, wait: r.wait }, r.status);
    return json({ ok: true, wait: r.wait, devCode: r.devCode, phone: fmtPhone(phone) });
  }
  if (b.action === 'check') {
    if (!rateLimit(`phone-check:${user.id}`, 30, 3600e3)) return fail('Слишком много попыток, попробуйте через час', 429);
    const r = await checkCall(user.id, str(b.code, 10));
    if (!r.ok) return json({ error: r.error, gone: r.gone ?? false }, r.status);
    logEvent('phone_verified', { user, detail: fmtPhone(r.phone).replace(/\d{2}-\d{2}$/, '**-**'), req });
    return json({ ok: true, phone: fmtPhone(r.phone) });
  }
  return fail('Неизвестное действие');
}
