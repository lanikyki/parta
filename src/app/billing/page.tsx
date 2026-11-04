import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountShell } from '@/components/app/AccountShell';
import { BillingClient } from '@/components/app/BillingClient';
import { getUser } from '@/lib/auth';
import { aiQuota, bonusBalance, discountFor, paymentTitle, paymentsOf, subscription, syncPayment, trialOf } from '@/lib/billing';
import { one } from '@/lib/db';
import { paymentProvider, recurringEnabled } from '@/lib/payments';

export const metadata: Metadata = { title: 'Подписка и баланс' };

type SP = Promise<{ paid?: string; back?: string }>;

export default async function BillingPage({ searchParams }: { searchParams: SP }) {
  const user = await getUser();
  const sp = await searchParams;
  if (!user) redirect(`/login?next=${encodeURIComponent('/billing')}`);
  if (user.role !== 'tutor')
    return (
      <AccountShell user={user} active="billing" title="Подписка и баланс">
        <section className="card p-6 text-[16px] text-ink-2">
          Ученикам всё бесплатно — подписку оформляет только репетитор.{' '}
          <Link href="/dashboard" className="text-brand-700 hover:underline">
            В кабинет
          </Link>
        </section>
      </AccountShell>
    );

  // Вернулись со страницы оплаты — сразу сверяем платёж с кассой
  let paid: { id: string; status: string; note: string | null } | null = null;
  if (sp.paid && /^[0-9a-f-]{36}$/.test(sp.paid)) {
    const p = await one<{ id: string }>('select id from payments where id = $1 and user_id = $2', [sp.paid, user.id]);
    if (p) {
      await syncPayment(p.id).catch(() => null);
      const r = await one<{ status: string; note: string | null }>('select status, note from payments where id = $1', [p.id]);
      if (r) paid = { id: p.id, status: r.status, note: r.note };
    }
  }
  const back = sp.back && /^\/lesson\/[\w-]{3,40}$/.test(sp.back) ? sp.back : '';

  const [sub, me, bonus, discount, quota, trial, history] = await Promise.all([
    subscription(user.id),
    one<{ phone: string | null }>('select phone from users where id = $1', [user.id]),
    bonusBalance(user.id),
    discountFor(user.id),
    aiQuota(user),
    trialOf(user.id),
    paymentsOf(user.id),
  ]);

  return (
    <AccountShell user={user} active="billing" title="Подписка и баланс" lead="Тариф, лимиты, бонусы и история оплат. Ученикам всё бесплатно — платит только репетитор.">
      <BillingClient
        data={{
          sub: { plan: sub.plan, until: sub.until, period: sub.period, autorenew: sub.autorenew, card: sub.card },
          phone: Boolean(me?.phone),
          bonus,
          discount,
          quota: { chat: quota.chat, extra: quota.extra, next: quota.next },
          trial,
          provider: paymentProvider(),
          recurring: recurringEnabled(),
          history: history.map((h) => ({
            id: h.id,
            at: new Date(h.paid_at ?? h.created_at).toISOString(),
            title: h.provider === 'admin' ? `${paymentTitle(h)} · подарок` : paymentTitle(h),
            amount: h.amount_kop,
            bonus: h.bonus_kop,
            discount: h.discount_kop,
            refunded: h.refunded_kop,
            status: h.status,
            card: h.card,
            auto: h.recurring,
            test: h.provider === 'test',
          })),
          paid,
          back,
        }}
      />
    </AccountShell>
  );
}
