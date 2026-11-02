import { q } from './db';
import { clientIp } from './http';

/** Что записываем в журнал админки. */
export const EVENT_LABELS = {
  register: 'Регистрация',
  login: 'Вход',
  login_fail: 'Неудачный вход',
  logout: 'Выход',
  reset: 'Смена пароля',
  lesson_create: 'Создал урок',
  lesson_delete: 'Удалил урок',
  lesson_join: 'Зашёл на урок',
  lesson_kick: 'Удалил участника из урока',
  ai_chat: 'Вопрос ИИ-помощнику',
  ai_tasks: 'Подбор задач',
  ai_summary: 'Итоги урока',
  lead: 'Обращение с сайта',
  invite: 'Принял приглашение',
  support: 'Написал в поддержку',
} as const;
export type EventKind = keyof typeof EVENT_LABELS;

type Who = { id: string; name: string } | null | undefined;

// Повторы одного и того же (например, переподключение к уроку) пишем не чаще раза в 15 минут
const recent = new Map<string, number>();
const DEDUPE_MS = 15 * 60e3;

/** Записывает событие в журнал. Ошибка записи не ломает основное действие. */
export function logEvent(kind: EventKind, opts: { user?: Who; actor?: string; detail?: string; req?: Request; dedupe?: string } = {}) {
  if (opts.dedupe) {
    const now = Date.now();
    if (recent.size > 5000) for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
    const last = recent.get(opts.dedupe);
    if (last && now - last < DEDUPE_MS) return;
    recent.set(opts.dedupe, now);
  }
  const actor = (opts.user?.name || opts.actor || 'Гость').slice(0, 120);
  q('insert into events (kind, user_id, actor, detail, ip) values ($1, $2, $3, $4, $5)', [
    kind,
    opts.user?.id ?? null,
    actor,
    opts.detail ? opts.detail.slice(0, 300) : null,
    opts.req ? clientIp(opts.req).slice(0, 64) : null,
  ]).catch((e) => console.error('[Журнал] не удалось записать событие:', (e as Error).message));
}
