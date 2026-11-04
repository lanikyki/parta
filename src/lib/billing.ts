import type { User } from './auth';
import { BRAND } from './brand';
import { one, q, tx, type Tx } from './db';
import { logEvent } from './events';
import { baseUrl } from './http';
import { uid } from './ids';
import { closeRoom, livekitConfigured, roomIdentities, roomName } from './livekit';
import { letter, mailErrorText, sendMail } from './mail';
import { phoneHash } from './phone';
import { cancelText, chargeSaved, createRemote, fetchRemote, paymentProvider, recurringEnabled, refundRemote, type Remote } from './payments';
import {
  type Current,
  FREE,
  PERIOD_NAME,
  PLANS,
  type Period,
  type PlanId,
  REF_HOLD_DAYS,
  REF_SHARE,
  STUDENT_AI,
  TRIAL_MIN,
  extendUntil,
  isPeriod,
  isPlan,
  longDate,
  quote,
  rub,
} from './plans';

// Подписка репетитора, пробный урок, лимиты ИИ, платежи, бонусы и реферальная программа.

/* ───────── Подписка ───────── */

type SubRow = {
  plan: string | null;
  plan_until: Date | null;
  plan_period: string | null;
  autorenew: boolean;
  pay_method: string | null;
  pay_method_title: string | null;
};

export type Sub = {
  /** Действующий тариф (null — бесплатный) */
  plan: PlanId | null;
  until: number | null;
  period: Period | null;
  autorenew: boolean;
  card: string | null;
};

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);

export function subOf(r: SubRow | null): Sub {
  const active = Boolean(r && isPlan(r.plan) && ms(r.plan_until) > Date.now());
  return {
    plan: active ? (r!.plan as PlanId) : null,
    until: active ? ms(r!.plan_until) : null,
    period: r && isPeriod(r.plan_period) ? r.plan_period : null,
    autorenew: Boolean(active && r!.autorenew && r!.pay_method),
    card: r?.pay_method ? r.pay_method_title || 'Сохранённая карта' : null,
  };
}

const SUB_COLS = 'plan, plan_until, plan_period, autorenew, pay_method, pay_method_title';

export async function subscription(userId: string) {
  return subOf(await one<SubRow>(`select ${SUB_COLS} from users where id = $1`, [userId]));
}

const current = (s: Sub): Current => (s.plan && s.until ? { plan: s.plan, until: s.until } : null);

/** «Про до 12 дек.» и т. п. — для меню и админки */
export const planName = (p: PlanId | null) => (p ? PLANS[p].name : 'Бесплатный');

/* ───────── Лимиты ИИ ───────── */

/** Месяц по Москве: «2025-11». Лимиты обновляются 1-го числа. */
export const monthKey = (t = Date.now()) => new Date(t + 3 * 3600e3).toISOString().slice(0, 7);
/** Когда обновятся лимиты: «1 декабря» */
export function nextMonthText() {
  const d = new Date(Date.now() + 3 * 3600e3);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12));
  return next.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export type AiKind = 'chat' | 'extra';
/** Сколько конспектов можно сделать в пробном уроке без тарифа */
export const TRIAL_SUMMARIES = 3;
export type Limits = { chat: number; extra: number | null; plan: PlanId | null };

export async function aiLimits(user: Pick<User, 'id' | 'role'>): Promise<Limits> {
  if (user.role !== 'tutor') return { chat: STUDENT_AI, extra: 0, plan: null };
  const s = await subscription(user.id);
  return s.plan ? { chat: PLANS[s.plan].ai, extra: PLANS[s.plan].extra, plan: s.plan } : { chat: FREE.ai, extra: FREE.extra, plan: null };
}

export async function aiUsage(userId: string) {
  const rows = await q<{ kind: string; n: number }>('select kind, n from ai_usage where user_id = $1 and month = $2', [userId, monthKey()]);
  return { chat: rows.find((r) => r.kind === 'chat')?.n ?? 0, extra: rows.find((r) => r.kind === 'extra')?.n ?? 0 };
}

/** null — можно; иначе — текст для человека и нужно ли предложить тариф. */
export async function aiBlocked(user: Pick<User, 'id' | 'role'>, kind: AiKind): Promise<{ error: string; upgrade: boolean } | null> {
  const [lim, used] = await Promise.all([aiLimits(user), aiUsage(user.id)]);
  const tutor = user.role === 'tutor';
  const when = `Новые появятся ${nextMonthText()}.`;
  if (kind === 'chat') {
    if (used.chat < lim.chat) return null;
    const more = !tutor ? '' : !lim.plan ? ' В тарифе «Старт» — 300 вопросов в месяц, в «Про» — 1000.' : lim.plan === 'start' ? ' Больше вопросов — в тарифе «Про».' : '';
    return { error: `Вопросы к ИИ-помощнику на этот месяц закончились (${lim.chat} из ${lim.chat}). ${when}${more}`, upgrade: tutor && lim.plan !== 'pro' };
  }
  if (lim.extra === null || used.extra < lim.extra) return null;
  if (!lim.plan) return { error: 'Конспекты и подбор задач — в тарифах «Старт» и «Про».', upgrade: true };
  return {
    error: `Конспекты и подборки задач на этот месяц закончились (${lim.extra} из ${lim.extra}). ${when} Без ограничений — в тарифе «Про».`,
    upgrade: true,
  };
}

/** Засчитывает один запрос к ИИ (после успешного ответа). trial — конспект в пробном уроке, считается отдельно и навсегда. */
export function countAi(userId: string, kind: AiKind | 'trial') {
  return q(
    `insert into ai_usage (user_id, month, kind, n) values ($1, $2, $3, 1)
     on conflict (user_id, month, kind) do update set n = ai_usage.n + 1`,
    [userId, kind === 'trial' ? 'trial' : monthKey(), kind],
  ).catch((e) => console.error('[ИИ] не удалось записать расход:', (e as Error).message));
}

/** Сколько ещё конспектов можно сделать в пробном уроке (0 — урок не пробный или попытки закончились). */
export async function trialSummaryLeft(userId: string, lessonId: string) {
  const t = await one('select 1 from trials where user_id = $1 and lesson_id = $2', [userId, lessonId]);
  if (!t) return 0;
  const r = await one<{ n: number }>("select n from ai_usage where user_id = $1 and month = 'trial' and kind = 'trial'", [userId]);
  return Math.max(0, TRIAL_SUMMARIES - (r?.n ?? 0));
}

/** Для страниц: сколько потрачено и сколько можно в этом месяце. */
export async function aiQuota(user: Pick<User, 'id' | 'role'>) {
  const [lim, used] = await Promise.all([aiLimits(user), aiUsage(user.id)]);
  return { plan: lim.plan, chat: { used: used.chat, limit: lim.chat }, extra: { used: used.extra, limit: lim.extra }, next: nextMonthText() };
}
export type AiQuota = Awaited<ReturnType<typeof aiQuota>>;

/* ───────── Видео в уроке ───────── */

export type VideoState =
  | { ok: true; via: 'plan'; plan: PlanId; max: number }
  | { ok: true; via: 'trial'; endsAt: number; max: number }
  /** phone — владельцу нужно подтвердить телефон; trial — можно начать пробный урок; trial-over — пробный урок здесь закончился; plan — нужна подписка */
  | { ok: false; reason: 'phone' | 'trial' | 'trial-over' | 'plan' };

type OwnerRow = SubRow & { phone: string | null };

/** Есть ли видео в уроке — зависит от тарифа репетитора (владельца урока). */
export async function videoState(lesson: { id: string; owner_id: string }): Promise<VideoState> {
  const o = await one<OwnerRow>(`select ${SUB_COLS}, phone from users where id = $1`, [lesson.owner_id]);
  const s = subOf(o);
  if (s.plan) return { ok: true, via: 'plan', plan: s.plan, max: PLANS[s.plan].video };
  const t = await one<{ lesson_id: string | null; ends_at: Date }>('select lesson_id, ends_at from trials where user_id = $1', [lesson.owner_id]);
  if (t) {
    if (t.lesson_id !== lesson.id) return { ok: false, reason: 'plan' };
    return ms(t.ends_at) > Date.now() ? { ok: true, via: 'trial', endsAt: ms(t.ends_at), max: PLANS.pro.video } : { ok: false, reason: 'trial-over' };
  }
  if (!o?.phone) return { ok: false, reason: 'phone' };
  // На этом номере пробный урок уже был (например, в другом аккаунте)
  if (await one('select 1 from trials where phone = any($1)', [[o.phone, phoneHash(o.phone)]])) return { ok: false, reason: 'plan' };
  return { ok: false, reason: 'trial' };
}

/** Начинает пробный урок в этом уроке (один раз на аккаунт и на номер телефона). */
export async function startTrial(lesson: { id: string; owner_id: string; code: string }, req?: Request) {
  const before = await videoState(lesson);
  if (before.ok || before.reason !== 'trial') return before;
  const o = await one<{ phone: string | null; name: string }>('select phone, name from users where id = $1', [lesson.owner_id]);
  if (!o?.phone) return before;
  const rows = await q(
    `insert into trials (id, user_id, phone, lesson_id, ends_at) values ($1, $2, $3, $4, now() + make_interval(mins => $5))
     on conflict do nothing returning id`,
    [uid(), lesson.owner_id, o.phone, lesson.id, TRIAL_MIN],
  );
  if (rows.length) logEvent('trial_start', { user: { id: lesson.owner_id, name: o.name }, detail: lesson.code, req });
  const after = await videoState(lesson);
  if (after.ok && after.via === 'trial') scheduleTrialEnd(lesson.id, after.endsAt);
  return after;
}

/** Сколько человек (кроме репетитора и самого входящего) уже в видеокомнате. */
export async function videoPeers(lesson: { id: string; code: string; owner_id: string }, who: string) {
  const ids = await roomIdentities(roomName(lesson.code));
  if (!ids.length) return 0;
  const rows = await q<{ who: string }>('select distinct who from lesson_people where lesson_id = $1 and identity = any($2)', [lesson.id, ids]);
  return rows.filter((r) => r.who !== who && r.who !== `u:${lesson.owner_id}`).length;
}

/* Конец пробного урока: видеокомнату закрываем (доска и чат остаются). Если репетитор успел оформить подписку — не трогаем. */
const timers = ((globalThis as { __partaTrialTimers?: Map<string, ReturnType<typeof setTimeout>> }).__partaTrialTimers ??= new Map());

export function scheduleTrialEnd(lessonId: string, endsAt: number) {
  clearTimeout(timers.get(lessonId));
  const t = setTimeout(() => {
    timers.delete(lessonId);
    endTrialIfOver(lessonId).catch((e) => console.error('[Пробный урок]', (e as Error).message));
  }, Math.max(0, endsAt - Date.now()) + 1500);
  t.unref?.();
  timers.set(lessonId, t);
}

export async function endTrialIfOver(lessonId: string) {
  const t = await one<{ user_id: string | null; code: string; ends_at: Date; closed_at: Date | null }>(
    'select t.user_id, l.code, t.ends_at, t.closed_at from trials t join lessons l on l.id = t.lesson_id where t.lesson_id = $1',
    [lessonId],
  );
  if (!t || t.closed_at || ms(t.ends_at) > Date.now()) return false;
  const paid = t.user_id ? (await subscription(t.user_id)).plan : null;
  if (!paid && livekitConfigured()) await closeRoom(roomName(t.code));
  await q('update trials set closed_at = now() where lesson_id = $1 and closed_at is null', [lessonId]);
  return !paid;
}

/* ───────── Бонусы ───────── */

export async function bonusBalance(userId: string, t?: Tx) {
  const sql = `select coalesce(sum(amount_kop) filter (where available_at <= now()), 0)::int as available,
                      coalesce(sum(amount_kop) filter (where available_at > now() and amount_kop > 0), 0)::int as pending
                 from bonus_ledger where user_id = $1 and canceled_at is null`;
  const r = t ? await t.one<{ available: number; pending: number }>(sql, [userId]) : await one<{ available: number; pending: number }>(sql, [userId]);
  return { available: Math.max(0, r?.available ?? 0), pending: r?.pending ?? 0 };
}

/** Похоже, что пригласивший и приглашённый — один человек: общий браузер или одна и та же карта. */
async function sameOwner(t: Tx, userId: string, referrerId: string, cardFp: string | null) {
  const r = await t.one(
    `select 1 from user_devices a join user_devices b on b.device = a.device where a.user_id = $1 and b.user_id = $2
     union all select 1 from payments where user_id = $2 and $3::text is not null and card_fp = $3
     limit 1`,
    [userId, referrerId, cardFp],
  );
  return Boolean(r);
}

/** Скидка 10% на первую оплату — тем, кто пришёл по приглашению. */
async function discountAllowed(t: Tx, userId: string, referredBy: string | null) {
  if (!referredBy) return false;
  const paid = await t.one("select 1 from payments where user_id = $1 and status in ('succeeded', 'refunded') and provider <> 'admin' limit 1", [userId]);
  if (paid) return false;
  return !(await sameOwner(t, userId, referredBy, null));
}

export async function discountFor(userId: string) {
  const u = await one<{ referred_by: string | null }>('select referred_by from users where id = $1', [userId]);
  return tx((t) => discountAllowed(t, userId, u?.referred_by ?? null));
}

/* ───────── Платежи ───────── */

export type PaymentRow = {
  id: string;
  user_id: string | null;
  provider: string;
  provider_id: string | null;
  plan: PlanId;
  period: Period;
  days: number;
  price_kop: number;
  discount_kop: number;
  bonus_kop: number;
  amount_kop: number;
  refunded_kop: number;
  status: 'pending' | 'succeeded' | 'canceled' | 'refunded';
  save_card: boolean;
  recurring: boolean;
  card: string | null;
  card_fp: string | null;
  note: string | null;
  created_at: Date;
  paid_at: Date | null;
  applied_at: Date | null;
};

export const paymentTitle = (p: Pick<PaymentRow, 'plan' | 'period' | 'days' | 'provider'>) =>
  `Тариф «${PLANS[p.plan]?.name ?? p.plan}» — ${p.provider === 'admin' ? `${p.days} дн.` : PERIOD_NAME[p.period]}`;

type Applied = { userId: string; email: string; name: string; notify: boolean; plan: PlanId; until: number; payment: PaymentRow; referral: { userId: string; amount: number; at: number } | null };

/** Оплата прошла: продлеваем тариф, начисляем бонус пригласившему. Повторный вызов ничего не делает. */
export async function applyPayment(id: string, remote?: Remote | null) {
  const res = await tx<Applied | null>(async (t) => {
    const p = await t.one<PaymentRow>('select * from payments where id = $1 for update', [id]);
    if (!p || p.applied_at || p.status === 'canceled' || p.status === 'refunded' || !p.user_id) return null;
    const u = await t.one<SubRow & { email: string; name: string; referred_by: string | null; notify_billing: boolean }>(
      `select ${SUB_COLS}, email, name, referred_by, notify_billing from users where id = $1 for update`,
      [p.user_id],
    );
    if (!u) return null;
    const now = Date.now();
    const { until } = extendUntil(current(subOf(u)), p.plan, p.days, now);
    const m = remote?.method ?? null;
    const save = Boolean(p.save_card && m?.saved && recurringEnabled());
    await t.q(
      `update users set plan = $2, plan_until = $3, plan_period = $4, remind_for = null, expired_for = null
         ${save ? ', pay_method = $5, pay_method_title = $6, autorenew = true' : ''} where id = $1`,
      save ? [p.user_id, p.plan, new Date(until), p.period, m!.id, m!.title] : [p.user_id, p.plan, new Date(until), p.period],
    );
    await t.q(
      `update payments set status = 'succeeded', paid_at = coalesce(paid_at, now()), applied_at = now(),
         card = coalesce($2, card), card_fp = coalesce($3, card_fp) where id = $1`,
      [id, m?.title ?? null, m?.fp ?? null],
    );
    // 20% с реальной оплаты — пригласившему (бонусы станут доступны через несколько дней)
    let referral: Applied['referral'] = null;
    if (p.amount_kop > 0 && u.referred_by && p.provider !== 'admin' && !(await sameOwner(t, p.user_id, u.referred_by, m?.fp ?? null))) {
      const amount = Math.round(p.amount_kop * REF_SHARE);
      const hold = p.provider === 'test' ? 0 : REF_HOLD_DAYS;
      const at = now + hold * 864e5;
      const r = await t.q(
        `insert into bonus_ledger (user_id, amount_kop, kind, payment_id, from_user, available_at) values ($1, $2, 'referral', $3, $4, $5)
         on conflict do nothing returning id`,
        [u.referred_by, amount, id, p.user_id, new Date(at)],
      );
      if (r.length && amount > 0) referral = { userId: u.referred_by, amount, at };
    }
    const fresh = await t.one<PaymentRow>('select * from payments where id = $1', [id]);
    return { userId: p.user_id, email: u.email, name: u.name, notify: u.notify_billing, plan: p.plan, until, payment: fresh!, referral };
  });
  if (!res) return false;
  const p = res.payment;
  if (p.provider !== 'admin')
    logEvent('payment', {
      user: { id: res.userId, name: res.name },
      detail: `${paymentTitle(p)} · ${rub(p.amount_kop)}${p.bonus_kop ? ` + бонусы ${rub(p.bonus_kop)}` : ''}${p.recurring ? ' · автопродление' : ''}${p.provider === 'test' ? ' · тест' : ''}`,
    });
  mailPaid(res).catch((e) => console.error('[Почта] письмо об оплате не отправлено:', mailErrorText(e)));
  return true;
}

async function mailPaid(r: Applied) {
  const url = baseUrl();
  const p = r.payment;
  const lines = [
    'Здравствуйте!',
    p.provider === 'admin'
      ? `Вам подключён тариф «${PLANS[r.plan].name}» в «${BRAND.name}». Он действует до ${longDate(r.until)}.`
      : `Оплата прошла: тариф «${PLANS[r.plan].name}» действует до ${longDate(r.until)}.`,
  ];
  if (p.provider !== 'admin')
    lines.push(
      `Списано: ${rub(p.amount_kop)}${p.bonus_kop ? `, бонусами — ${rub(p.bonus_kop)}` : ''}${p.discount_kop ? `. Скидка по приглашению — ${rub(p.discount_kop)}` : ''}.`,
    );
  const l = letter({ lines, button: { href: `${url}/billing`, label: 'Подписка и баланс' } });
  await sendMail(r.email, p.recurring ? `Подписка «${PLANS[r.plan].name}» продлена` : `Оплата прошла — тариф «${PLANS[r.plan].name}»`, l.text, l.html);
  if (r.referral) {
    const ref = await one<{ email: string; notify_billing: boolean }>('select email, notify_billing from users where id = $1', [r.referral.userId]);
    if (ref?.notify_billing) {
      const soon = r.referral.at > Date.now() + 60e3;
      const m = letter({
        lines: [
          'Здравствуйте!',
          `Коллега, которого вы пригласили, оплатил подписку. Вам начислено ${rub(r.referral.amount)} бонусов${soon ? ` — их можно будет потратить с ${longDate(r.referral.at)}` : ''}.`,
          'Бонусами можно оплатить подписку в «Парте».',
        ],
        button: { href: `${url}/referral`, label: 'Реферальная программа' },
      });
      await sendMail(ref.email, `Вам начислены бонусы — ${rub(r.referral.amount)}`, m.text, m.html);
    }
  }
}

/** Платёж не прошёл или отменён: возвращаем бонусы, которые на него отложили. */
export async function cancelPayment(id: string, reason?: string | null) {
  return tx(async (t) => {
    const p = await t.one<PaymentRow>('select * from payments where id = $1 for update', [id]);
    if (!p || p.status !== 'pending') return false;
    await t.q("update payments set status = 'canceled', note = coalesce($2, note) where id = $1", [id, reason ? cancelText(reason) || reason : null]);
    await t.q("update bonus_ledger set canceled_at = now() where payment_id = $1 and kind = 'spend' and canceled_at is null", [id]);
    return true;
  });
}

/** Сверяет платёж с кассой (после возврата со страницы оплаты, по уведомлению или в фоне). */
export async function syncPayment(id: string) {
  const p = await one<PaymentRow>('select * from payments where id = $1', [id]);
  if (!p || p.status !== 'pending' || !p.provider_id) return p?.status ?? null;
  const r = await fetchRemote(p.provider, p.provider_id);
  if (!r) return p.status;
  if (r.status === 'succeeded') await applyPayment(id, r);
  else if (r.status === 'canceled') await cancelPayment(id, r.reason);
  return (await one<{ status: string }>('select status from payments where id = $1', [id]))?.status ?? null;
}

export type CheckoutInput = { plan: PlanId; period: Period; useBonus: boolean; autorenew: boolean; returnUrl: string };

/** Оформление подписки: считает сумму, откладывает бонусы и создаёт платёж в кассе. */
export async function checkout(user: Pick<User, 'id' | 'role' | 'email' | 'name'>, inp: CheckoutInput): Promise<{ url?: string; done?: boolean; id: string } | { error: string; status: number }> {
  if (user.role !== 'tutor') return { error: 'Подписка нужна только репетиторам — ученикам всё бесплатно', status: 403 };
  const provider = paymentProvider();
  const me = await one<{ phone: string | null }>('select phone from users where id = $1', [user.id]);
  if (!me?.phone) return { error: 'Сначала подтвердите номер телефона', status: 400 };
  const id = uid();
  const made = await tx(async (t) => {
    const u = await t.one<SubRow & { referred_by: string | null }>(`select ${SUB_COLS}, referred_by from users where id = $1 for update`, [user.id]);
    if (!u) return null;
    const bal = await bonusBalance(user.id, t);
    const qt = quote({
      plan: inp.plan,
      period: inp.period,
      current: current(subOf(u)),
      now: Date.now(),
      bonus: bal.available,
      useBonus: inp.useBonus,
      discount: await discountAllowed(t, user.id, u.referred_by),
    });
    if (qt.amount > 0 && !provider) return { qt, blocked: true as const };
    await t.q(
      `insert into payments (id, user_id, provider, plan, period, days, price_kop, discount_kop, bonus_kop, amount_kop, save_card)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, user.id, qt.amount === 0 ? 'bonus' : provider, inp.plan, inp.period, qt.days, qt.price, qt.discount, qt.bonus, qt.amount, inp.autorenew && recurringEnabled()],
    );
    if (qt.bonus > 0)
      await t.q("insert into bonus_ledger (user_id, amount_kop, kind, payment_id, note) values ($1, $2, 'spend', $3, $4)", [
        user.id,
        -qt.bonus,
        id,
        paymentTitle({ plan: inp.plan, period: inp.period, days: qt.days, provider: 'bonus' }),
      ]);
    return { qt, blocked: false as const };
  });
  if (!made) return { error: 'Аккаунт не найден', status: 404 };
  if (made.blocked) return { error: 'Оплата пока не подключена — попробуйте позже', status: 503 };
  if (made.qt.amount === 0) {
    await applyPayment(id);
    return { done: true, id };
  }
  try {
    const r = await createRemote(provider!, {
      id,
      amount: made.qt.amount,
      description: `${BRAND.name}: ${paymentTitle({ plan: inp.plan, period: inp.period, days: made.qt.days, provider: 'x' })}`,
      returnUrl: inp.returnUrl.replace('{id}', id),
      email: user.email,
      save: inp.autorenew && recurringEnabled(),
    });
    await q('update payments set provider_id = $2 where id = $1', [id, r.providerId]);
    return { url: r.url, id };
  } catch (e) {
    console.error('[Оплата] не удалось создать платёж:', (e as Error).message);
    await cancelPayment(id, 'Касса не ответила');
    return { error: 'Касса не ответила — попробуйте ещё раз через минуту', status: 502 };
  }
}

/** Возврат денег (из админки или по уведомлению кассы). refundId — номер возврата в кассе: один возврат учитываем один раз. */
export async function markRefunded(id: string, amount: number, refundId: string) {
  return tx(async (t) => {
    const p = await t.one<PaymentRow>('select * from payments where id = $1 for update', [id]);
    if (!p || p.status !== 'succeeded' || !p.user_id) return false;
    const fresh = await t.q('insert into refunds (id, payment_id, amount_kop) values ($1, $2, $3) on conflict do nothing returning id', [refundId, id, amount]);
    if (!fresh.length) return false;
    const refunded = Math.min(p.amount_kop, p.refunded_kop + Math.max(0, amount));
    const delta = refunded - p.refunded_kop;
    if (delta <= 0) return false;
    const full = refunded >= p.amount_kop;
    await t.q('update payments set refunded_kop = $2, status = $3 where id = $1', [id, refunded, full ? 'refunded' : 'succeeded']);
    // Забираем дни пропорционально возврату (не раньше сегодняшнего дня): вернули треть — минус треть срока
    const u = await t.one<SubRow>(`select ${SUB_COLS} from users where id = $1 for update`, [p.user_id]);
    const s = subOf(u);
    if (s.plan && s.until) {
      const share = full ? 1 : delta / p.amount_kop;
      const cut = p.days * 864e5 * share * (s.plan === p.plan ? 1 : PLANS[p.plan].price.month / PLANS[s.plan].price.month);
      const until = Math.max(Date.now(), s.until - cut);
      await t.q('update users set plan_until = $2 where id = $1', [p.user_id, new Date(until)]);
    }
    // Полный возврат — возвращаем и потраченные бонусы
    if (full) await t.q("update bonus_ledger set canceled_at = now() where payment_id = $1 and kind = 'spend' and canceled_at is null", [id]);
    // Бонус пригласившего: ещё не стал доступен — отменяем, уже доступен — списываем
    const ref = await t.one<{ id: string; user_id: string; amount_kop: number; available_at: Date; canceled_at: Date | null }>(
      "select id, user_id, amount_kop, available_at, canceled_at from bonus_ledger where payment_id = $1 and kind = 'referral'",
      [id],
    );
    if (ref && !ref.canceled_at) {
      const back = Math.round(delta * REF_SHARE);
      if (full && ms(ref.available_at) > Date.now()) await t.q('update bonus_ledger set canceled_at = now() where id = $1', [ref.id]);
      else if (back > 0)
        await t.q(
          `insert into bonus_ledger (user_id, amount_kop, kind, payment_id, note) values ($1, $2, 'refund', $3, 'Оплату друга вернули')
           on conflict (payment_id, kind) where payment_id is not null do update set amount_kop = bonus_ledger.amount_kop + excluded.amount_kop`,
          [ref.user_id, -Math.min(back, ref.amount_kop), id],
        );
    }
    return true;
  });
}

/** Возврат из админки: деньги — через кассу, дни и бонусы — сразу (или когда касса подтвердит возврат). */
export async function refundPayment(id: string, amount?: number): Promise<{ status: string } | { error: string }> {
  const p = await one<PaymentRow>('select * from payments where id = $1', [id]);
  if (!p || p.status !== 'succeeded') return { error: 'Платёж не найден или уже возвращён' };
  if (p.provider !== 'yookassa' && p.provider !== 'test') return { error: 'Этот платёж прошёл без карты — возвращать нечего' };
  const left = p.amount_kop - p.refunded_kop;
  const sum = Math.min(left, amount && amount > 0 ? Math.round(amount) : left);
  if (sum <= 0 || !p.provider_id) return { error: 'Нечего возвращать' };
  try {
    const r = await refundRemote(p.provider, p.provider_id, sum, `refund_${id}_${p.refunded_kop}`);
    if (r.status === 'succeeded') await markRefunded(id, sum, r.id);
    return { status: r.status };
  } catch (e) {
    console.error('[Оплата] возврат не прошёл:', (e as Error).message);
    return { error: `Касса не приняла возврат: ${(e as Error).message}` };
  }
}

/** История оплат для страницы «Подписка и баланс». */
export async function paymentsOf(userId: string, limit = 30) {
  return q<PaymentRow>(
    "select * from payments where user_id = $1 and (status <> 'pending' or created_at > now() - interval '1 day') order by created_at desc limit $2",
    [userId, limit],
  );
}

/** Пробный урок: ещё не был / идёт / закончился. */
export async function trialOf(userId: string) {
  const t = await one<{ code: string | null; title: string | null; started_at: Date; ends_at: Date }>(
    'select l.code, l.title, t.started_at, t.ends_at from trials t left join lessons l on l.id = t.lesson_id where t.user_id = $1',
    [userId],
  );
  if (!t) return null;
  return { code: t.code, title: t.title, startedAt: ms(t.started_at), endsAt: ms(t.ends_at), active: ms(t.ends_at) > Date.now() };
}

/** Администратор выдал тариф на N дней (без оплаты). */
export async function grantPlan(userId: string, plan: PlanId, days: number, note: string) {
  const id = uid();
  await q(
    `insert into payments (id, user_id, provider, plan, period, days, price_kop, amount_kop, note) values ($1, $2, 'admin', $3, 'month', $4, 0, 0, $5)`,
    [id, userId, plan, days, note || null],
  );
  await applyPayment(id);
  return id;
}

/** Включить или выключить автопродление. Выключить — значит и забыть карту. */
export async function setAutorenew(userId: string, on: boolean) {
  if (on) {
    const r = await q("update users set autorenew = true where id = $1 and pay_method is not null and plan_until > now() returning id", [userId]);
    return r.length > 0;
  }
  await q('update users set autorenew = false, pay_method = null, pay_method_title = null where id = $1', [userId]);
  return true;
}

/* ───────── Фоновые задачи: автопродление, напоминания, зависшие платежи ───────── */

/** Продлевает подписки с автопродлением за сутки до окончания. */
export async function runAutorenew() {
  const provider = paymentProvider();
  if (!provider || !recurringEnabled()) return;
  const due = await q<{ id: string; email: string; name: string; plan: string; plan_period: string | null; pay_method: string }>(
    `select u.id, u.email, u.name, u.plan, u.plan_period, u.pay_method from users u
      where u.autorenew and u.pay_method is not null and u.plan_until > now() - interval '3 days' and u.plan_until < now() + interval '1 day'
        and not exists (select 1 from payments p where p.user_id = u.id and p.recurring and p.created_at > now() - interval '20 hours')
      limit 50`,
  );
  for (const u of due) {
    if (!isPlan(u.plan)) continue;
    await renewOne(provider, u).catch((e) => console.error('[Автопродление] ошибка:', (e as Error).message));
  }
}

async function renewOne(provider: NonNullable<ReturnType<typeof paymentProvider>>, u: { id: string; email: string; plan: string; plan_period: string | null; pay_method: string }) {
  {
    const period: Period = isPeriod(u.plan_period) ? u.plan_period : 'month';
    const id = uid();
    const made = await tx(async (t) => {
      const row = await t.one<SubRow>(`select ${SUB_COLS} from users where id = $1 for update`, [u.id]);
      const bal = await bonusBalance(u.id, t);
      const qt = quote({ plan: u.plan as PlanId, period, current: current(subOf(row)), now: Date.now(), bonus: bal.available, useBonus: true, discount: false });
      await t.q(
        `insert into payments (id, user_id, provider, plan, period, days, price_kop, bonus_kop, amount_kop, recurring, save_card)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, true)`,
        [id, u.id, qt.amount === 0 ? 'bonus' : provider, u.plan, period, qt.days, qt.price, qt.bonus, qt.amount],
      );
      if (qt.bonus > 0)
        await t.q("insert into bonus_ledger (user_id, amount_kop, kind, payment_id, note) values ($1, $2, 'spend', $3, 'Автопродление')", [u.id, -qt.bonus, id]);
      return qt;
    });
    if (made.amount === 0) {
      await applyPayment(id);
      return;
    }
    try {
      const r = await chargeSaved(provider, {
        id,
        amount: made.amount,
        description: `${BRAND.name}: автопродление тарифа «${PLANS[u.plan as PlanId].name}» — ${PERIOD_NAME[period]}`,
        email: u.email,
        methodId: u.pay_method,
      });
      await q('update payments set provider_id = $2 where id = $1', [id, r.providerId]);
      if (r.remote.status === 'succeeded') await applyPayment(id, r.remote);
      else if (r.remote.status === 'canceled') {
        await cancelPayment(id, r.remote.reason);
        await renewFailed(u, cancelText(r.remote.reason));
      }
    } catch (e) {
      console.error('[Автопродление] ошибка:', (e as Error).message);
      await cancelPayment(id, 'Касса не ответила');
    }
  }
}

async function renewFailed(u: { id: string; email: string }, why: string) {
  // Карта не сработала: автопродление выключаем, чтобы не списывать снова и снова, и пишем об этом
  await setAutorenew(u.id, false);
  const l = letter({
    lines: ['Здравствуйте!', `Не получилось продлить подписку: ${why || 'банк отклонил списание'}. Автопродление выключено.`, 'Продлить подписку можно вручную — это займёт минуту.'],
    button: { href: `${baseUrl()}/billing`, label: 'Продлить подписку' },
  });
  await sendMail(u.email, 'Не получилось продлить подписку', l.text, l.html).catch((e) => console.error('[Почта]', mailErrorText(e)));
}

/** Письма: «подписка закончится через 3 дня» и «подписка закончилась». */
export async function runReminders() {
  const soon = await q<{ id: string; email: string; plan: string; plan_until: Date; plan_period: string | null; autorenew: boolean; pay_method_title: string | null; pay_method: string | null }>(
    `select id, email, plan, plan_until, plan_period, autorenew, pay_method, pay_method_title from users
      where notify_billing and plan_until > now() + interval '1 day' and plan_until < now() + interval '3 days'
        and remind_for is distinct from plan_until limit 100`,
  );
  for (const u of soon) {
    if (!isPlan(u.plan)) continue;
    await q('update users set remind_for = plan_until where id = $1', [u.id]);
    const auto = u.autorenew && u.pay_method && recurringEnabled();
    const period: Period = isPeriod(u.plan_period) ? u.plan_period : 'month';
    const l = letter({
      lines: auto
        ? [
            'Здравствуйте!',
            `${longDate(u.plan_until)} подписка «${PLANS[u.plan].name}» продлится автоматически: спишем ${rub(PLANS[u.plan].price[period])} (${u.pay_method_title || 'сохранённая карта'}). Бонусы с баланса спишутся первыми.`,
            'Если продлевать не нужно, отключите автопродление — это один клик.',
          ]
        : ['Здравствуйте!', `Подписка «${PLANS[u.plan].name}» закончится ${longDate(u.plan_until)}.`, 'Продлите её, чтобы уроки с видео и ИИ-помощник работали без перерыва.'],
      button: { href: `${baseUrl()}/billing`, label: auto ? 'Управлять подпиской' : 'Продлить подписку' },
    });
    await sendMail(u.email, auto ? 'Скоро продлим подписку' : 'Подписка скоро закончится', l.text, l.html).catch((e) => console.error('[Почта]', mailErrorText(e)));
  }
  const ended = await q<{ id: string; email: string; plan: string; plan_until: Date }>(
    `select id, email, plan, plan_until from users
      where notify_billing and plan_until < now() and plan_until > now() - interval '2 days' and expired_for is distinct from plan_until limit 100`,
  );
  for (const u of ended) {
    if (!isPlan(u.plan)) continue;
    await q('update users set expired_for = plan_until where id = $1', [u.id]);
    const l = letter({
      lines: ['Здравствуйте!', `Подписка «${PLANS[u.plan].name}» закончилась. Кабинет, переписка и доска работают как обычно, а видео и ИИ-помощник — по подписке.`],
      button: { href: `${baseUrl()}/billing`, label: 'Продлить подписку' },
    });
    await sendMail(u.email, 'Подписка закончилась', l.text, l.html).catch((e) => console.error('[Почта]', mailErrorText(e)));
  }
}

/** Платежи, по которым касса не прислала ответ: сверяем, а совсем старые — отменяем. */
export async function runPendingSync() {
  const rows = await q<{ id: string; provider: string; created_at: Date }>(
    "select id, provider, created_at from payments where status = 'pending' and created_at < now() - interval '5 minutes' order by created_at limit 30",
  );
  for (const r of rows) {
    try {
      if (r.provider === 'yookassa') await syncPayment(r.id);
      if (ms(r.created_at) < Date.now() - 864e5) await cancelPayment(r.id, 'expired_on_confirmation');
    } catch (e) {
      console.error('[Оплата] сверка не удалась:', (e as Error).message);
    }
  }
}

/** Пробные уроки, время которых вышло, а комната ещё открыта. */
export async function runTrialSweep() {
  const rows = await q<{ lesson_id: string }>(
    "select lesson_id from trials where closed_at is null and lesson_id is not null and ends_at <= now() and ends_at > now() - interval '2 days' limit 50",
  );
  for (const r of rows) await endTrialIfOver(r.lesson_id).catch((e) => console.error('[Пробный урок]', (e as Error).message));
}
