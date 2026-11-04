import { isAdmin } from '@/lib/admin';
import { getUser } from '@/lib/auth';
import { bonusBalance, grantPlan, refundPayment } from '@/lib/billing';
import { one, q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { body, fail, json, str } from '@/lib/http';
import { PLANS, isPlan, rub } from '@/lib/plans';

type Body = { action: string; email: string; plan: string; days: number; amount: number; note: string; id: string };

/** Админка, вкладка «Платежи»: выдать тариф, начислить бонусы, вернуть оплату. Суммы — в копейках. */
export async function POST(req: Request) {
  const admin = await getUser();
  if (!admin || !isAdmin(admin)) return fail('Нет доступа', 404);
  const b = await body<Body>(req);
  const note = str(b.note, 200);

  if (b.action === 'refund') {
    const id = str(b.id, 40);
    const p = await one<{ amount_kop: number; refunded_kop: number; name: string | null; email: string | null }>(
      'select p.amount_kop, p.refunded_kop, u.name, u.email from payments p left join users u on u.id = p.user_id where p.id = $1',
      [id],
    );
    if (!p) return fail('Платёж не найден', 404);
    const left = p.amount_kop - p.refunded_kop;
    const amount = Math.round(Number(b.amount) || 0);
    if (amount < 0 || amount > left) return fail(`Вернуть можно не больше ${rub(left)}`, 400);
    const r = await refundPayment(id, amount || undefined);
    if ('error' in r) return fail(r.error, 400);
    logEvent('refund', { user: admin, detail: `${p.name ?? 'Удалённый пользователь'} (${p.email ?? '—'}): ${rub(amount || left)}`, req });
    return json(r);
  }

  const email = str(b.email, 200).toLowerCase();
  const target = email ? await one<{ id: string; name: string; email: string; role: string }>('select id, name, email, role from users where lower(email) = $1', [email]) : null;
  if (!target) return fail('Пользователь с такой почтой не найден', 404);
  if (target.role !== 'tutor') return fail('Это ученик — ученики занимаются бесплатно, тариф и бонусы нужны только репетиторам', 400);

  if (b.action === 'grant') {
    if (!isPlan(b.plan)) return fail('Выберите тариф', 400);
    const days = Math.round(Number(b.days));
    if (!Number.isFinite(days) || days < 1 || days > 3660) return fail('Срок — от 1 до 3660 дней', 400);
    await grantPlan(target.id, b.plan, days, note || `Выдал(а) ${admin.name}`);
    logEvent('plan_grant', { user: admin, detail: `${target.name} (${target.email}): «${PLANS[b.plan].name}» на ${days} дн.${note ? ` — ${note}` : ''}`, req });
    return json({ ok: true });
  }

  if (b.action === 'bonus') {
    const amount = Math.round(Number(b.amount));
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 10_000_000) return fail('Сумма — от 1 до 100 000 ₽ (со знаком минус — списать)', 400);
    if (amount < 0) {
      const bal = await bonusBalance(target.id);
      if (bal.available + amount < 0) return fail(`Списать можно не больше ${rub(bal.available)} — столько бонусов доступно`, 400);
    }
    await q("insert into bonus_ledger (user_id, amount_kop, kind, note) values ($1, $2, 'admin', $3)", [
      target.id,
      amount,
      note || (amount > 0 ? 'Начисление от администрации' : 'Списание администрацией'),
    ]);
    logEvent('bonus_grant', { user: admin, detail: `${target.name} (${target.email}): ${amount > 0 ? '+' : ''}${rub(amount)}${note ? ` — ${note}` : ''}`, req });
    return json({ ok: true });
  }

  return fail('Неизвестное действие', 400);
}
