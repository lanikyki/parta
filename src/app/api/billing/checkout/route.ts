import { getUser } from '@/lib/auth';
import { checkout } from '@/lib/billing';
import { body, fail, json, rateLimit, siteUrl } from '@/lib/http';
import { legal } from '@/lib/legal';
import { paymentProvider } from '@/lib/payments';
import { isPeriod, isPlan } from '@/lib/plans';

/** Оформить подписку: { plan, period, useBonus, autorenew, back } → ссылка на оплату (или сразу готово, если хватило бонусов). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  if (!rateLimit(`checkout:${user.id}`, 20, 3600e3)) return fail('Слишком много попыток, попробуйте через час', 429);
  // Настоящие деньги принимаем, только когда в оферте указан продавец: LEGAL_NAME, LEGAL_INN и LEGAL_OGRNIP в .env
  if (paymentProvider() === 'yookassa' && !legal().filled) {
    console.error('[Оплата] Оплата выключена: впишите LEGAL_NAME, LEGAL_INN и LEGAL_OGRNIP в .env и перезапустите сайт.');
    return fail('Оплата временно недоступна. Напишите нам в поддержку, и мы поможем.', 503);
  }
  const b = await body<{ plan: string; period: string; useBonus: boolean; autorenew: boolean; back: string }>(req);
  if (!isPlan(b.plan) || !isPeriod(b.period)) return fail('Выберите тариф и срок');
  // Куда вернуть после оплаты: только в урок на этом же сайте
  const back = typeof b.back === 'string' && /^\/lesson\/[\w-]{3,40}$/.test(b.back) ? b.back : '';
  const r = await checkout(user, {
    plan: b.plan,
    period: b.period,
    useBonus: b.useBonus === true,
    autorenew: b.autorenew === true,
    returnUrl: `${siteUrl(req)}/billing?paid={id}${back ? `&back=${encodeURIComponent(back)}` : ''}`,
  });
  if ('error' in r) return fail(r.error, r.status);
  return json(r);
}
