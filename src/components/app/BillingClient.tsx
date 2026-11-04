'use client';

import { ArrowLeft, Check, CircleAlert, CreditCard, Gift, LoaderCircle, Sparkles, Video } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PlanCards } from '@/components/PlanCards';
import { PLANS, type Period, type PlanId, REF_DISCOUNT, TRIAL_MIN, daysText, longDate, quote, rub } from '@/lib/plans';
import { PhoneVerify } from './PhoneVerify';

export type HistoryItem = { id: string; at: string; title: string; amount: number; bonus: number; discount: number; refunded: number; status: string; card: string | null; auto: boolean; test: boolean };

export type BillingData = {
  sub: { plan: PlanId | null; until: number | null; period: Period | null; autorenew: boolean; card: string | null };
  phone: boolean;
  bonus: { available: number; pending: number };
  discount: boolean;
  quota: { chat: { used: number; limit: number }; extra: { used: number; limit: number | null }; next: string };
  trial: { code: string | null; title: string | null; endsAt: number; active: boolean } | null;
  provider: 'yookassa' | 'test' | null;
  recurring: boolean;
  history: HistoryItem[];
  paid: { id: string; status: string; note: string | null } | null;
  back: string;
};

const STATUS: Record<string, [string, string]> = {
  succeeded: ['Оплачено', 'text-mint'],
  pending: ['Ждём оплату', 'text-ink-3'],
  canceled: ['Не прошла', 'text-danger-600'],
  refunded: ['Возврат', 'text-ink-3'],
};

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = !limit ? 0 : Math.min(100, (used / limit) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className="text-ink-2">{label}</span>
        <span className="shrink-0 font-medium">{limit === null ? 'без ограничений' : limit === 0 ? 'нет в тарифе' : `${used} из ${limit}`}</span>
      </div>
      <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-mist">
        {pct > 0 && <span className={`block h-full rounded-full ${pct >= 90 ? 'bg-accent' : 'bg-brand'}`} style={{ width: `${pct}%` }} />}
      </span>
    </div>
  );
}

export function BillingClient({ data }: { data: BillingData }) {
  const router = useRouter();
  const { sub } = data;
  const [period, setPeriod] = useState<Period>('month');
  const [plan, setPlan] = useState<PlanId | null>(null);
  const [useBonus, setUseBonus] = useState(data.bonus.available > 0);
  const [auto, setAuto] = useState(data.recurring);
  const [phone, setPhone] = useState(data.phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paid, setPaid] = useState(data.paid);
  const panel = useRef<HTMLDivElement>(null);
  const [now] = useState(() => Date.now());

  // Банк ещё подтверждает оплату — спрашиваем раз в 3 секунды (до двух минут)
  useEffect(() => {
    if (paid?.status !== 'pending') return;
    let n = 0;
    const t = setInterval(async () => {
      n++;
      const r = await fetch(`/api/billing/status?id=${paid.id}`, { cache: 'no-store' })
        .then((x) => x.json())
        .catch(() => null);
      if (r?.status && r.status !== 'pending') {
        clearInterval(t);
        router.refresh();
        setPaid({ ...paid, status: r.status });
      } else if (n >= 40) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
  }, [paid, router]);

  const q = useMemo(
    () =>
      plan
        ? quote({ plan, period, current: sub.plan && sub.until ? { plan: sub.plan, until: sub.until } : null, now, bonus: data.bonus.available, useBonus, discount: data.discount })
        : null,
    [plan, period, sub, now, data.bonus.available, useBonus, data.discount],
  );

  function choose(p: PlanId, per: Period) {
    setPlan(p);
    setPeriod(per);
    setError('');
    setTimeout(() => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function pay() {
    if (!q) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: q.plan, period: q.period, useBonus, autorenew: auto && data.recurring, back: data.back }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Не получилось начать оплату');
      if (out.url) {
        window.location.href = out.url;
        return;
      }
      window.location.href = `/billing?paid=${out.id}${data.back ? `&back=${encodeURIComponent(data.back)}` : ''}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function stopAuto() {
    if (!confirm('Отключить автопродление? Подписка будет действовать до конца оплаченного срока, сохранённая карта удалится.')) return;
    await fetch('/api/billing/autorenew', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: false }) }).catch(() => null);
    router.refresh();
  }

  const current = sub.plan ? PLANS[sub.plan] : null;
  const daysLeft = sub.until ? Math.max(0, Math.ceil((sub.until - now) / 864e5)) : 0;

  return (
    <>
      {paid && <PaidBanner paid={paid} back={data.back} sub={sub} />}

      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div>
            <p className="text-[14px] text-ink-3">Ваш тариф</p>
            <h2 className="mt-0.5 text-[26px] leading-tight font-medium">{current ? `«${current.name}»` : 'Бесплатный'}</h2>
            <p className="mt-1 text-[15px] text-ink-2">
              {sub.until ? (
                <>
                  Действует до {longDate(sub.until)} — осталось {daysText(daysLeft)}
                </>
              ) : (
                'Кабинет, доска, чат и переписка — бесплатно и без ограничений'
              )}
            </p>
          </div>
          {data.bonus.available > 0 || data.bonus.pending > 0 ? (
            <Link href="/referral" className="rounded-2xl bg-tint px-4 py-3 text-[14px] text-brand-800 hover:bg-tint-2">
              <span className="flex items-center gap-1.5">
                <Gift size={16} /> Бонусы
              </span>
              <b className="mt-0.5 block text-[20px] leading-tight font-medium">{rub(data.bonus.available)}</b>
              {data.bonus.pending > 0 && <span className="block text-[13px] text-brand-800/80">ещё {rub(data.bonus.pending)} скоро</span>}
            </Link>
          ) : null}
        </div>

        {sub.plan && data.recurring && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-mist px-4 py-3 text-[14px]">
            <CreditCard size={18} className="shrink-0 text-ink-3" />
            {sub.autorenew ? (
              <>
                <span className="min-w-0 flex-1">
                  Автопродление включено{sub.card ? ` · ${sub.card}` : ''}. Спишем {rub(PLANS[sub.plan].price[sub.period ?? 'month'])} за день до конца срока.
                </span>
                <button type="button" onClick={stopAuto} className="font-medium text-brand-700 hover:underline">
                  Отключить
                </button>
              </>
            ) : (
              <span className="min-w-0 flex-1 text-ink-2">Автопродление выключено. Включить его можно при следующей оплате картой.</span>
            )}
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Meter label="Вопросы ИИ-помощнику" used={data.quota.chat.used} limit={data.quota.chat.limit} />
          <Meter label="Конспекты и подборки задач" used={data.quota.extra.used} limit={data.quota.extra.limit} />
        </div>
        <p className="mt-2 text-[13px] text-ink-3">Лимиты на месяц обновятся {data.quota.next}.</p>

        {!sub.plan && (
          <div className="mt-5 flex items-start gap-3 border-t border-line pt-5 text-[15px]">
            <Video size={20} className="mt-0.5 shrink-0 text-brand-700" />
            <p className="text-ink-2">
              {!data.trial ? (
                <>
                  <b className="font-medium text-ink">Пробный видеоурок — {TRIAL_MIN}&nbsp;минут бесплатно.</b> Откройте любой урок и нажмите «Начать пробный урок». Видео выключится через {TRIAL_MIN}&nbsp;минут, доска и чат останутся.
                </>
              ) : data.trial.active ? (
                <>
                  <b className="font-medium text-ink">Пробный урок идёт</b> до{' '}
                  {new Date(data.trial.endsAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  {data.trial.code && (
                    <>
                      {' '}
                      ·{' '}
                      <Link href={`/lesson/${data.trial.code}`} className="text-brand-700 hover:underline">
                        вернуться в урок
                      </Link>
                    </>
                  )}
                </>
              ) : (
                <>
                  <b className="font-medium text-ink">Пробный урок использован.</b> Видео в уроках — в тарифах «Старт» и «Про», доска и чат работают и так.
                </>
              )}
            </p>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xl font-medium">{sub.plan ? 'Продлить или сменить тариф' : 'Выбрать тариф'}</h2>
        <PlanCards current={sub.plan} onChoose={choose} free={false} period={period} onPeriod={setPeriod} chosen={plan} />
      </section>

      {plan && q && (
        <section ref={panel} className="card scroll-mt-24 p-5 sm:p-6">
          <h2 className="text-lg font-medium">
            Оплата: тариф «{PLANS[plan].name}» на {period === 'month' ? 'месяц' : 'год'}
          </h2>
          {!data.provider ? (
            <p className="mt-3 rounded-2xl bg-[#fff4cc] px-4 py-3 text-[15px] text-ink">
              Оплата картой скоро появится. Если хотите подключиться уже сейчас — напишите в{' '}
              <Link href="/messages?support=1" className="font-medium underline">
                поддержку
              </Link>
              .
            </p>
          ) : !phone ? (
            <div className="mt-3">
              <p className="mb-4 max-w-[560px] text-[15px] text-ink-2">Перед первой оплатой подтвердите номер телефона — один раз. Мы позвоним, отвечать не нужно.</p>
              <PhoneVerify onDone={() => setPhone(true)} />
            </div>
          ) : (
            <>
              <dl className="mt-4 grid gap-2 text-[15px]">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-2">Тариф «{PLANS[plan].name}», {period === 'month' ? 'месяц' : 'год'}</dt>
                  <dd>{rub(q.price)}</dd>
                </div>
                {q.discount > 0 && (
                  <div className="flex justify-between gap-4 text-brand-700">
                    <dt>Скидка {Math.round(REF_DISCOUNT * 100)}% по приглашению</dt>
                    <dd>−{rub(q.discount)}</dd>
                  </div>
                )}
                {data.bonus.available > 0 && (
                  <div className="flex items-center justify-between gap-4">
                    <dt>
                      <label className="flex cursor-pointer items-center gap-2.5">
                        <input type="checkbox" checked={useBonus} onChange={(e) => setUseBonus(e.target.checked)} className="h-5 w-5 accent-[var(--color-brand)]" />
                        Списать бонусы <span className="text-ink-3">(есть {rub(data.bonus.available)})</span>
                      </label>
                    </dt>
                    <dd className={q.bonus ? 'text-brand-700' : 'text-ink-3'}>{q.bonus ? `−${rub(q.bonus)}` : '—'}</dd>
                  </div>
                )}
                <div className="mt-1 flex justify-between gap-4 border-t border-line pt-3 text-[18px] font-medium">
                  <dt>К оплате</dt>
                  <dd>{rub(q.amount)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[14px] text-ink-2">
                {q.converted ? (
                  <>
                    Оставшиеся {daysText(q.converted.fromDays)} тарифа «{PLANS[q.converted.fromPlan].name}» пересчитаем по цене в {daysText(q.converted.toDays)} тарифа «
                    {PLANS[plan].name}». Новый тариф будет действовать до <b className="font-medium text-ink">{longDate(q.until)}</b>.
                  </>
                ) : (
                  <>
                    Тариф будет действовать до <b className="font-medium text-ink">{longDate(q.until)}</b>
                    {sub.plan === plan ? ' — дни добавятся к текущему сроку.' : '.'}
                  </>
                )}
              </p>
              {data.recurring && q.amount > 0 && (
                <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[14px] text-ink-2">
                  <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand)]" />
                  <span>
                    Продлевать автоматически: спишем {rub(PLANS[plan].price[period])} с этой карты за день до конца срока. Отключить можно в любой момент здесь же.
                  </span>
                </label>
              )}
              {data.provider === 'test' && (
                <p className="mt-4 flex items-start gap-2 rounded-2xl bg-[#fff4cc] px-4 py-3 text-[14px] text-ink">
                  <CircleAlert size={17} className="mt-0.5 shrink-0" /> Тестовый режим: касса ещё не подключена, деньги не спишутся. Откроется тестовая страница оплаты.
                </p>
              )}
              {error && <p className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger-600">{error}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
                <button type="button" className="btn btn-primary btn-lg max-sm:w-full" onClick={pay} disabled={busy}>
                  {busy ? <LoaderCircle size={18} className="animate-spin" /> : <Sparkles size={18} />}
                  {q.amount > 0 ? `Оплатить ${rub(q.amount)}` : 'Оплатить бонусами'}
                </button>
                <p className="text-[13px] text-ink-3">
                  Нажимая кнопку, вы принимаете{' '}
                  <Link href="/legal/offer" target="_blank" className="underline hover:text-ink">
                    условия оферты
                  </Link>
                  .
                </p>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card p-5 sm:p-6">
        <h2 className="text-lg font-medium">История оплат</h2>
        {data.history.length ? (
          <ul className="mt-3 divide-y divide-line">
            {data.history.map((h) => (
              <li key={h.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-3 text-[15px]">
                <span className="min-w-0">
                  <b className="block font-medium">
                    {h.title}
                    {h.auto && <>{' '}<span className="inline-flex h-5 items-center rounded-full bg-mist px-2 align-[1px] text-[12px] leading-none font-normal text-ink-2">автопродление</span></>}
                    {h.test && <>{' '}<span className="inline-flex h-5 items-center rounded-full bg-mist px-2 align-[1px] text-[12px] leading-none font-normal text-ink-2">тест</span></>}
                  </b>
                  <span className="text-[13px] text-ink-3">
                    {new Date(h.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                    {h.card ? ` · ${h.card}` : ''}
                    {h.bonus ? ` · бонусами ${rub(h.bonus)}` : ''}
                    {h.discount ? ` · скидка ${rub(h.discount)}` : ''}
                  </span>
                </span>
                <span className="text-right">
                  <b className="block font-medium">{rub(h.amount)}</b>
                  <span className={`text-[13px] ${STATUS[h.status]?.[1] ?? 'text-ink-3'}`}>
                    {h.status === 'succeeded' && h.refunded ? `Возврат ${rub(h.refunded)}` : (STATUS[h.status]?.[0] ?? h.status)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[15px] text-ink-2">Оплат пока не было.</p>
        )}
        <p className="mt-3 border-t border-line pt-3 text-[14px] text-ink-3">
          Приглашайте коллег: вам — 20% с их оплат бонусами, им — скидка 10% на первую оплату.{' '}
          <Link href="/referral" className="text-brand-700 hover:underline">
            Реферальная программа
          </Link>
        </p>
      </section>
      <p className="text-[13px] text-ink-3">
        Вопросы по оплате и возвратам —{' '}
        <Link href="/messages?support=1" className="underline hover:text-ink">
          в поддержку
        </Link>
        .
      </p>
    </>
  );
}

function PaidBanner({ paid, back, sub }: { paid: NonNullable<BillingData['paid']>; back: string; sub: BillingData['sub'] }) {
  if (paid.status === 'succeeded')
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[20px] bg-tint px-5 py-4 text-brand-800">
        <Check size={22} className="shrink-0" />
        <p className="min-w-0 flex-1 text-[16px]">
          <b className="font-medium">Оплата прошла.</b> {sub.plan && sub.until ? `Тариф «${PLANS[sub.plan].name}» действует до ${longDate(sub.until)}.` : ''}
        </p>
        {back && (
          <Link href={back} className="btn btn-primary btn-sm">
            <ArrowLeft size={16} /> Вернуться в урок
          </Link>
        )}
      </div>
    );
  if (paid.status === 'pending')
    return (
      <div className="flex items-center gap-3 rounded-[20px] bg-mist px-5 py-4 text-[16px] text-ink-2">
        <LoaderCircle size={20} className="shrink-0 animate-spin" /> Ждём подтверждения оплаты от банка — обычно это несколько секунд.
      </div>
    );
  return (
    <div className="flex items-start gap-3 rounded-[20px] bg-danger-soft px-5 py-4 text-[16px] text-danger-600">
      <CircleAlert size={20} className="mt-0.5 shrink-0" />
      <p>
        <b className="font-medium">Оплата не прошла</b>
        {paid.note ? `: ${paid.note}` : ''}. Деньги не списаны — попробуйте ещё раз или выберите другую карту.
      </p>
    </div>
  );
}
