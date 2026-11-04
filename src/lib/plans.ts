// Тарифы, цены и лимиты — всё в одном месте. Меняйте здесь: обновятся сайт, оплата и проверки.
// Суммы — в копейках (29900 = 299 ₽). Файл без серверного кода: его используют и страницы, и сервер.

export type PlanId = 'start' | 'pro';
export type Period = 'month' | 'year';

export const PLANS = {
  start: {
    id: 'start',
    name: 'Старт',
    price: { month: 29900, year: 299000 },
    /** Сколько человек в уроке с видео (вместе с репетитором) */
    video: 2,
    /** Вопросов ИИ-помощнику в месяц */
    ai: 300,
    /** Конспектов и подборок задач в месяц (null — без ограничений) */
    extra: 20 as number | null,
    features: ['Видеоуроки один на один', 'ИИ-помощник — 300 вопросов в месяц', 'Конспекты и подбор задач — 20 в месяц', 'Кабинет, переписка и доска'],
  },
  pro: {
    id: 'pro',
    name: 'Про',
    price: { month: 59900, year: 599000 },
    video: 20,
    ai: 1000,
    extra: null as number | null,
    features: ['Групповые видеоуроки до 20 человек', 'ИИ-помощник — 1000 вопросов в месяц', 'Конспекты и подбор задач без ограничений', 'Кабинет, переписка и доска'],
  },
} as const;

export const PLAN_IDS: PlanId[] = ['start', 'pro'];

/** Бесплатно: кабинет, переписка, доска и чат — без ограничений; видео — один пробный урок. */
export const FREE = {
  ai: 10,
  extra: 0,
  features: ['Кабинет, переписка, доска и чат', 'Пробный видеоурок — 60 минут', 'ИИ-помощник — 10 вопросов в месяц'],
};

/** Ученики не платят. Сколько вопросов ИИ-помощнику у ученика в месяц. */
export const STUDENT_AI = 50;

/** Пробный видеоурок, минут */
export const TRIAL_MIN = 60;

export const PERIOD_DAYS: Record<Period, number> = { month: 30, year: 365 };
export const PERIOD_NAME: Record<Period, string> = { month: 'месяц', year: 'год' };

/** Реферальная программа: пригласившему — 20% с каждой оплаты друга, другу — скидка 10% на первую оплату. */
export const REF_SHARE = 0.2;
export const REF_DISCOUNT = 0.1;
/** Через сколько дней после оплаты друга бонусы можно потратить (если оплату не вернули) */
export const REF_HOLD_DAYS = 7;

/** Меньше 1 ₽ платёжный сервис не принимает — столько оставляем к оплате картой, если бонусов не хватает чуть-чуть. */
export const MIN_CHARGE = 100;

export const isPlan = (v: unknown): v is PlanId => v === 'start' || v === 'pro';
export const isPeriod = (v: unknown): v is Period => v === 'month' || v === 'year';

/** 29900 → «299 ₽», 11980 → «119,80 ₽» */
export function rub(kop: number) {
  const neg = kop < 0;
  const abs = Math.abs(Math.round(kop));
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${neg ? '−' : ''}${w}${cents ? `,${String(cents).padStart(2, '0')}` : ''}\u00a0₽`;
}

/** Сколько процентов экономит оплата за год по сравнению с 12 месяцами */
export const yearSaving = (p: PlanId) => Math.round((1 - PLANS[p].price.year / (PLANS[p].price.month * 12)) * 100);

export type Current = { plan: PlanId; until: number } | null;

export type Quote = {
  plan: PlanId;
  period: Period;
  price: number;
  discount: number;
  bonus: number;
  amount: number;
  days: number;
  /** Сколько дней прежнего тарифа пересчитали в дни нового (при смене тарифа) */
  converted: { fromPlan: PlanId; fromDays: number; toDays: number } | null;
  until: number;
};

/**
 * Расчёт оплаты: цена, скидка по приглашению, сколько бонусов спишется и до какого числа будет действовать тариф.
 * Тот же тариф — продлеваем от даты окончания. Другой тариф — оставшиеся дни пересчитываем по цене
 * (20 дней «Старта» = 10 дней «Про»), а новый период добавляем сверху.
 */
export function quote(o: { plan: PlanId; period: Period; current: Current; now: number; bonus: number; useBonus: boolean; discount: boolean }): Quote {
  const price = PLANS[o.plan].price[o.period];
  const discount = o.discount ? Math.round(price * REF_DISCOUNT) : 0;
  const due = price - discount;
  let bonus = o.useBonus ? Math.max(0, Math.min(Math.floor(o.bonus), due)) : 0;
  if (due - bonus > 0 && due - bonus < MIN_CHARGE) bonus = Math.max(0, due - MIN_CHARGE);
  const days = PERIOD_DAYS[o.period];
  const ext = extendUntil(o.current, o.plan, days, o.now);
  return { plan: o.plan, period: o.period, price, discount, bonus, amount: due - bonus, days, converted: ext.converted, until: ext.until };
}

/** До какого числа будет действовать тариф plan, если добавить days дней (с пересчётом остатка другого тарифа). */
export function extendUntil(current: Current, plan: PlanId, days: number, now: number) {
  let base = now;
  let converted: Quote['converted'] = null;
  const cur = current && current.until > now ? current : null;
  if (cur && cur.plan === plan) base = cur.until;
  else if (cur) {
    const left = cur.until - now;
    const ms = (left * PLANS[cur.plan].price.month) / PLANS[plan].price.month;
    base = now + ms;
    converted = { fromPlan: cur.plan, fromDays: Math.max(1, Math.round(left / 864e5)), toDays: Math.round(ms / 864e5) };
  }
  return { until: base + days * 864e5, converted };
}

/** «12 декабря 2025» */
export const longDate = (t: number | string | Date) =>
  new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
/** «12 дек.» */
export const shortDate = (t: number | string | Date) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «3 дня», «21 день» */
export const daysText = (n: number) => `${n}\u00a0${plural(n, 'день', 'дня', 'дней')}`;
