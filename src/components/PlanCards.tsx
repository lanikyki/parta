'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FREE, PLANS, PLAN_IDS, type Period, type PlanId, TRIAL_MIN, rub, yearSaving } from '@/lib/plans';

const perMonth = (p: PlanId) => Math.floor(PLANS[p].price.year / 12 / 100) * 100;

/** Переключатель «Месяц / Год». */
export function PeriodSwitch({ value, onChange, dark = false }: { value: Period; onChange: (p: Period) => void; dark?: boolean }) {
  const save = Math.min(...PLAN_IDS.map(yearSaving));
  return (
    <div className={`inline-flex rounded-full p-1 ${dark ? 'bg-white/10' : 'bg-mist'}`} role="group" aria-label="Срок подписки">
      {(
        [
          ['month', 'На месяц'],
          ['year', 'На год'],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-[15px] transition-colors ${
            value === v ? 'bg-white font-medium text-brand-800 shadow-soft' : dark ? 'text-white/80 hover:text-white' : 'text-ink-2 hover:text-ink'
          }`}
        >
          {label}
          {v === 'year' && <span className="rounded-full bg-sun px-2 py-0.5 text-[12px] leading-none font-medium text-ink">−{save}%</span>}
        </button>
      ))}
    </div>
  );
}

type Props = {
  /** Действующий тариф (на странице оплаты) */
  current?: PlanId | null;
  /** Выбрали тариф — на странице оплаты. Без него кнопки ведут по ссылке href. */
  onChoose?: (plan: PlanId, period: Period) => void;
  href?: string;
  /** Показывать бесплатный тариф */
  free?: boolean;
  freeHref?: string;
  period?: Period;
  onPeriod?: (p: Period) => void;
  chosen?: PlanId | null;
};

export function PlanCards({ current = null, onChoose, href = '/register?role=tutor', free = true, freeHref = '/register?role=tutor', period: outer, onPeriod, chosen = null }: Props) {
  const [own, setOwn] = useState<Period>('month');
  const period = outer ?? own;
  const setPeriod = onPeriod ?? setOwn;

  const button = (plan: PlanId) => {
    const label = !current ? 'Выбрать' : current === plan ? 'Продлить' : `Перейти на «${PLANS[plan].name}»`;
    const cls = `btn mt-6 w-full ${plan === 'pro' ? 'btn-white' : 'btn-primary'} ${chosen === plan ? 'ring-4 ring-sun' : ''}`;
    return onChoose ? (
      <button type="button" className={cls} onClick={() => onChoose(plan, period)}>
        {label}
      </button>
    ) : (
      <Link href={href} className={cls}>
        {label}
      </Link>
    );
  };

  return (
    <div>
      <div className="flex justify-center">
        <PeriodSwitch value={period} onChange={setPeriod} />
      </div>
      <div className={`mt-6 grid grid-cols-1 gap-4 ${free ? 'lg:grid-cols-3' : 'md:grid-cols-2'}`}>
        {free && (
          <div className="card flex flex-col p-6">
            <h3 className="text-[20px] font-medium">Бесплатный</h3>
            <p className="mt-1 text-[14px] text-ink-3">Чтобы познакомиться с сервисом</p>
            <p className="mt-5 flex items-baseline gap-1.5">
              <b className="text-[36px] leading-none font-medium tracking-tight">0&nbsp;₽</b>
              <span className="text-ink-3">навсегда</span>
            </p>
            <p className="mt-1.5 h-5 text-[13px] text-ink-3" />
            <ul className="mt-5 grid flex-1 content-start gap-2.5 text-[15px]">
              {FREE.features.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Check size={18} className="mt-0.5 shrink-0 text-brand" /> {f}
                </li>
              ))}
            </ul>
            {onChoose ? (
              <p className="mt-6 grid h-12 place-items-center rounded-xl bg-mist text-[15px] text-ink-2">{current ? 'Остаётся после подписки' : 'Ваш тариф сейчас'}</p>
            ) : (
              <Link href={freeHref} className="btn btn-line mt-6 w-full">
                Начать бесплатно
              </Link>
            )}
          </div>
        )}
        {PLAN_IDS.map((id) => {
          const p = PLANS[id];
          const pro = id === 'pro';
          return (
            <div key={id} className={`relative flex flex-col rounded-[20px] p-6 ${pro ? 'bg-brand-950 text-white' : 'card'}`}>
              {pro && <span className="absolute top-6 right-6 rounded-full bg-sun px-2.5 py-1 text-[12px] leading-none font-medium text-ink">Для групп</span>}
              <h3 className="text-[20px] font-medium">«{p.name}»</h3>
              <p className={`mt-1 text-[14px] ${pro ? 'text-white/70' : 'text-ink-3'}`}>{pro ? 'Группы и безлимитные конспекты' : 'Для занятий один на один'}</p>
              <p className="mt-5 flex items-baseline gap-1.5">
                <b className="text-[36px] leading-none font-medium tracking-tight">{rub(p.price[period])}</b>
                <span className={pro ? 'text-white/70' : 'text-ink-3'}>{period === 'month' ? 'в месяц' : 'в год'}</span>
              </p>
              <p className={`mt-1.5 h-5 text-[13px] ${pro ? 'text-white/70' : 'text-ink-3'}`}>
                {period === 'year' ? `≈ ${rub(perMonth(id))} в месяц — выгода ${yearSaving(id)}%` : `Или ${rub(p.price.year)} за год`}
              </p>
              <ul className="mt-5 grid flex-1 content-start gap-2.5 text-[15px]">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Check size={18} className={`mt-0.5 shrink-0 ${pro ? 'text-sun' : 'text-brand'}`} /> {f}
                  </li>
                ))}
              </ul>
              {button(id)}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-center text-[14px] text-ink-3">
        Ученики занимаются бесплатно — платит только репетитор. Пробный видеоурок на {TRIAL_MIN}&nbsp;минут — без оплаты.
      </p>
    </div>
  );
}
