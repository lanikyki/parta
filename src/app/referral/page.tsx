import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountShell } from '@/components/app/AccountShell';
import { RefLink } from '@/components/app/RefLink';
import { getUser } from '@/lib/auth';
import { bonusBalance } from '@/lib/billing';
import { q } from '@/lib/db';
import { REF_DISCOUNT, REF_HOLD_DAYS, REF_SHARE, longDate, plural, rub } from '@/lib/plans';
import { ensureRefCode, referralStats } from '@/lib/referral';

export const metadata: Metadata = { title: 'Реферальная программа' };

/** «Анна Петрова» → «Анна П.» — полное имя коллеги не показываем */
const short = (name: string) => {
  const [a, b] = name.trim().split(/\s+/);
  return b ? `${a} ${b[0].toUpperCase()}.` : a || 'Коллега';
};

const KIND: Record<string, string> = { referral: 'За оплату коллеги', spend: 'Оплата подписки', refund: 'Оплату коллеги вернули', admin: 'Начисление от поддержки' };

export default async function ReferralPage({ searchParams }: { searchParams: Promise<{ self?: string }> }) {
  const user = await getUser();
  if (!user) redirect('/login?next=/referral');
  const sp = await searchParams;
  if (user.role !== 'tutor')
    return (
      <AccountShell user={user} active="referral" title="Реферальная программа">
        <section className="card p-6 text-[16px] text-ink-2">Реферальная программа — для репетиторов: они оплачивают подписку, ученикам всё бесплатно.</section>
      </AccountShell>
    );
  const [code, stats, bonus, ledger] = await Promise.all([
    ensureRefCode(user.id),
    referralStats(user.id),
    bonusBalance(user.id),
    q<{ amount_kop: number; kind: string; note: string | null; created_at: Date; available_at: Date; canceled_at: Date | null; name: string | null }>(
      `select b.amount_kop, b.kind, b.note, b.created_at, b.available_at, b.canceled_at, u.name
         from bonus_ledger b left join users u on u.id = b.from_user where b.user_id = $1 order by b.created_at desc limit 30`,
      [user.id],
    ),
  ]);
  const share = Math.round(REF_SHARE * 100);
  const disc = Math.round(REF_DISCOUNT * 100);
  return (
    <AccountShell
      user={user}
      active="referral"
      title="Реферальная программа"
      lead={`Приглашайте коллег-репетиторов: вам — ${share}% с каждой их оплаты бонусами, им — скидка ${disc}% на первую оплату.`}
    >
      {sp.self && (
        <p className="rounded-[20px] bg-[#fff4cc] px-5 py-4 text-[15px] text-ink">Это ваша собственная ссылка — по ней приходят коллеги. Отправьте её тому, кого хотите пригласить.</p>
      )}
      <section className="card p-5 sm:p-6">
        <h2 className="mb-4 text-lg font-medium">Ваша ссылка</h2>
        {code ? <RefLink code={code} /> : <p className="text-[15px] text-ink-2">Не получилось создать ссылку — обновите страницу.</p>}
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ['Пришли по ссылке', String(stats.invited)],
            ['Оплатили', String(stats.paying)],
            ['Бонусов доступно', rub(bonus.available)],
            ['Скоро станут доступны', rub(bonus.pending)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-[13px] text-ink-3">{label}</p>
            <b className="mt-1 block text-[24px] leading-tight font-medium">{value}</b>
          </div>
        ))}
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="text-lg font-medium">Как это работает</h2>
        <ol className="mt-3 grid gap-3 text-[15px] text-ink-2">
          {[
            'Отправьте ссылку коллеге-репетитору. Если он зарегистрируется не сразу, приглашение сохранится 60 дней.',
            `Коллега регистрируется и получает скидку ${disc}% на первую оплату подписки.`,
            `С каждой его оплаты вам начисляется ${share}% бонусами. Они станут доступны через ${REF_HOLD_DAYS} дней — если оплату не вернут.`,
            'Бонусами можно оплатить подписку: 1 бонус = 1 ₽. Вывести их деньгами нельзя.',
          ].map((t, i) => (
            <li key={t} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tint font-mono text-[12px] text-brand-800">{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[13px] text-ink-3">
          Приглашать самого себя нельзя: если второй аккаунт открыт в том же браузере или оплачен той же картой, бонусы не начисляются. Если оплату коллеги вернули,
          бонусы за неё списываются.{' '}
          <Link href="/legal/offer#referral" className="underline hover:text-ink">
            Условия
          </Link>
        </p>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="text-lg font-medium">Приглашённые коллеги</h2>
        {stats.people.length ? (
          <ul className="mt-3 divide-y divide-line">
            {stats.people.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-[15px]">
                <span>
                  <b className="font-medium">{short(p.name)}</b>
                  <span className="ml-2 text-[13px] text-ink-3">с {longDate(p.joined)}</span>
                </span>
                <span className="text-[14px] text-ink-2">
                  {p.paid ? `оплатил(а) ${p.paid} ${plural(p.paid, 'раз', 'раза', 'раз')} · ` : 'ещё не оплачивал(а) · '}
                  <b className="font-medium text-ink">{rub(p.earned + p.pending)}</b>
                  {p.pending > 0 && <span className="text-ink-3"> (из них {rub(p.pending)} скоро)</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[15px] text-ink-2">Пока никого. Отправьте ссылку коллеге — он появится здесь сразу после регистрации.</p>
        )}
      </section>

      {ledger.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="text-lg font-medium">Движение бонусов</h2>
          <ul className="mt-3 divide-y divide-line">
            {ledger.map((b, i) => {
              const later = !b.canceled_at && new Date(b.available_at).getTime() > Date.now();
              return (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-[15px]">
                  <span className="min-w-0">
                    <b className="block font-medium">
                      {KIND[b.kind] ?? b.kind}
                      {b.kind === 'referral' && b.name ? ` — ${short(b.name)}` : ''}
                    </b>
                    <span className="text-[13px] text-ink-3">
                      {longDate(b.created_at)}
                      {b.note && b.kind !== 'referral' ? ` · ${b.note}` : ''}
                      {later ? ` · станут доступны ${longDate(b.available_at)}` : ''}
                      {b.canceled_at ? ' · отменено' : ''}
                    </span>
                  </span>
                  <b className={`font-medium ${b.canceled_at ? 'text-ink-3 line-through' : b.amount_kop > 0 ? 'text-brand-700' : 'text-ink'}`}>
                    {b.amount_kop > 0 ? '+' : ''}
                    {rub(b.amount_kop)}
                  </b>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </AccountShell>
  );
}
