import type { Metadata } from 'next';
import Link from 'next/link';
import { PlanCards } from '@/components/PlanCards';
import { Footer } from '@/components/landing/Footer';
import { Header } from '@/components/landing/Header';
import { getUser } from '@/lib/auth';
import { REF_DISCOUNT, TRIAL_MIN } from '@/lib/plans';

export const metadata: Metadata = { title: 'Тарифы', description: 'Бесплатный тариф, «Старт» и «Про»: видеоуроки, доска, переписка и ИИ-помощник для репетиторов.' };

const FAQ = [
  ['Кто платит?', 'Только репетитор. Ученики занимаются бесплатно, а на урок по ссылке заходят даже без регистрации.'],
  [
    'Что такое пробный урок?',
    `Один видеоурок на ${TRIAL_MIN} минут без оплаты — в любом вашем уроке. Нужно один раз подтвердить номер телефона звонком. Доска, чат и переписка работают и без подписки.`,
  ],
  ['Можно сменить тариф?', 'Да, в любой момент. Оставшиеся дни пересчитаем по цене нового тарифа — ничего не сгорит.'],
  ['Как отменить?', 'Автопродление отключается одной кнопкой в разделе «Подписка и баланс». За неиспользованные дни вернём деньги — напишите в поддержку.'],
  ['Есть скидки?', `Годовая подписка выгоднее помесячной. А если вас пригласил коллега, первая оплата — со скидкой ${Math.round(REF_DISCOUNT * 100)}%.`],
] as const;

export default async function PricingPage() {
  const user = await getUser().catch(() => null);
  const href = user ? (user.role === 'tutor' ? '/billing' : '/dashboard') : '/register?role=tutor';
  return (
    <>
      <Header loggedIn={Boolean(user)} />
      <main className="bg-mist/60">
        <section className="wrap py-12 sm:py-16">
          <div className="mx-auto max-w-[680px] text-center">
            <p className="tag text-brand-700">Тарифы</p>
            <h1 className="mt-3 text-[34px] leading-[1.1] font-medium tracking-[-0.02em] sm:text-[48px]">Платит только репетитор</h1>
            <p className="mt-4 text-[17px] text-ink-2 sm:text-[18px]">
              Начните бесплатно: кабинет, доска и переписка — без ограничений, пробный видеоурок — {TRIAL_MIN}&nbsp;минут. Видеоуроки и ИИ-функции — по подписке.
            </p>
          </div>
          <div className="mt-10">
            <PlanCards href={href} freeHref={user ? '/dashboard' : '/register?role=tutor'} />
          </div>
        </section>
        <section className="wrap pb-16">
          <div className="mx-auto max-w-[760px]">
            <h2 className="text-[26px] font-medium">Частые вопросы</h2>
            <div className="mt-4 grid gap-3">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group card px-5 open:pb-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-[17px] font-medium [&::-webkit-details-marker]:hidden">
                    {q}
                    <span className="text-[22px] leading-none text-ink-3 transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="text-[16px] text-ink-2">{a}</p>
                </details>
              ))}
            </div>
            <p className="mt-6 text-[14px] text-ink-3">
              Оплата картой через ЮKassa. Условия — в <Link href="/legal/offer" className="underline hover:text-ink">публичной оферте</Link>.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
