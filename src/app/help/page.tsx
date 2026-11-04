import { LifeBuoy, Mail } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountShell } from '@/components/app/AccountShell';
import { getUser } from '@/lib/auth';
import { legal } from '@/lib/legal';
import { supportEnabled } from '@/lib/messages';
import { PLANS, TRIAL_MIN } from '@/lib/plans';

export const metadata: Metadata = { title: 'Помощь и поддержка' };

const TUTOR: [string, React.ReactNode][] = [
  ['Как провести первый урок?', 'В кабинете нажмите «Новый урок», скопируйте ссылку и отправьте ученику. Ученику не нужно регистрироваться — достаточно открыть ссылку в браузере.'],
  [
    'Как работает пробный урок?',
    `Один видеоурок на ${TRIAL_MIN} минут — бесплатно. Откройте урок и нажмите «Начать пробный урок» — нужно один раз подтвердить номер телефона звонком. Через ${TRIAL_MIN} минут видео выключится, а доска и чат останутся.`,
  ],
  [
    'Чем отличаются тарифы?',
    <>
      «{PLANS.start.name}» — видеоуроки один на один, «{PLANS.pro.name}» — группы до {PLANS.pro.video} человек и безлимитные конспекты. Сравнение — на странице{' '}
      <Link href="/pricing" className="text-brand-700 hover:underline">
        «Тарифы»
      </Link>
      .
    </>,
  ],
  [
    'Как отключить автопродление или вернуть деньги?',
    <>
      Автопродление отключается в разделе{' '}
      <Link href="/billing" className="text-brand-700 hover:underline">
        «Подписка и баланс»
      </Link>
      . За неиспользованные дни вернём деньги — напишите в поддержку.
    </>,
  ],
  [
    'Что такое бонусы?',
    <>
      Приглашайте коллег по своей ссылке: с каждой их оплаты вы получаете 20% бонусами, а они — скидку 10% на первую оплату. Подробнее — в разделе{' '}
      <Link href="/referral" className="text-brand-700 hover:underline">
        «Реферальная программа»
      </Link>
      .
    </>,
  ],
];

const COMMON: [string, React.ReactNode][] = [
  [
    'Не работает камера или микрофон',
    <>
      Проверьте их в{' '}
      <Link href="/settings#devices" className="text-brand-700 hover:underline">
        настройках
      </Link>
      . Если браузер не дал доступ — нажмите на значок замка слева от адреса сайта и разрешите камеру и микрофон. Закройте Zoom, Skype и другие вкладки с камерой.
    </>,
  ],
  ['Плохо слышно или видео тормозит', 'Подключитесь ближе к роутеру или по кабелю, закройте лишние вкладки. Если связь слабая, выключите своё видео — звук станет стабильнее.'],
  ['Где конспекты уроков?', 'В кабинете под каждым уроком — кнопка «Конспект урока». Репетитор составляет его кнопкой «Итоги» в конце урока.'],
  [
    'Как удалить аккаунт?',
    <>
      В{' '}
      <Link href="/settings" className="text-brand-700 hover:underline">
        настройках
      </Link>
      , внизу страницы. Уроки, доски и переписка удалятся навсегда.
    </>,
  ],
];

export default async function HelpPage() {
  const user = await getUser();
  if (!user) redirect('/login?next=/help');
  const l = legal();
  const faq = user.role === 'tutor' ? [...TUTOR, ...COMMON] : COMMON;
  return (
    <AccountShell user={user} active="help" title="Помощь и поддержка" lead="Ответы на частые вопросы. Не нашли ответ — напишите нам, ответим в течение дня.">
      <section className="grid gap-3 sm:grid-cols-2">
        {supportEnabled() && (
          <Link href="/messages?support=1" className="group card flex items-start gap-4 p-5 transition-shadow hover:shadow-soft">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-white">
              <LifeBuoy size={20} />
            </span>
            <span>
              <b className="block font-medium">Написать в поддержку</b>
              <span className="text-[14px] text-ink-2">Чат на сайте — ответ придёт в «Сообщения» и на почту</span>
            </span>
          </Link>
        )}
        {l.email && (
          <a href={`mailto:${l.email}`} className="card flex items-start gap-4 p-5 transition-shadow hover:shadow-soft">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-tint text-brand-700">
              <Mail size={20} />
            </span>
            <span className="min-w-0">
              <b className="block font-medium">Почта</b>
              <span className="block truncate text-[14px] text-ink-2">{l.email}</span>
            </span>
          </a>
        )}
      </section>
      <section className="grid gap-3">
        {faq.map(([q, a]) => (
          <details key={q} className="group card px-5 open:pb-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
              {q}
              <span className="text-[22px] leading-none text-ink-3 transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="text-[15px] text-ink-2">{a}</div>
          </details>
        ))}
      </section>
      <p className="text-[14px] text-ink-3">
        Документы:{' '}
        <Link href="/legal/offer" className="underline hover:text-ink">
          оферта
        </Link>
        ,{' '}
        <Link href="/legal/privacy" className="underline hover:text-ink">
          политика конфиденциальности
        </Link>
        ,{' '}
        <Link href="/legal/contacts" className="underline hover:text-ink">
          контакты и реквизиты
        </Link>
        .
      </p>
    </AccountShell>
  );
}
