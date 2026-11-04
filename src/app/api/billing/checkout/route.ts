import { getUser } from '@/lib/auth';
import { checkout } from '@/lib/billing';
import { body, fail, json, rateLimit, siteUrl } from '@/lib/http';
import { isPeriod, isPlan } from '@/lib/plans';

/** Оформить подписку: { plan, period, useBonus, autorenew, back } → ссылка на оплату (или сразу готово, если хватило бонусов). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  if (!rateLimit(`checkout:${user.id}`, 20, 3600e3)) return fail('Слишком много попыток, попробуйте через час', 429);
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
