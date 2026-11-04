import crypto from 'node:crypto';
import { one, q } from './db';
import { rateLimit } from './http';

// Подтверждение телефона звонком: сервис звонит на номер, а кодом служат последние 4 цифры номера, с которого звонили.
// Отвечать на звонок не нужно. Сервис — SMS.ru (раздел «Авторизация по звонку»), ключ — SMSRU_API_ID.
// Пока ключа нет, на своём компьютере (и с TEST_MODE=1 на сервере) код показывается прямо на странице.

const CODE_TTL_MIN = 10;
export const CALL_WAIT_SEC = 60;
const MAX_ATTEMPTS = 5;

/** «+7 (912) 345-67-89», «8 912 345 67 89», «9123456789» → «79123456789». Только российские мобильные номера. */
export function normPhone(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = `7${d.slice(1)}`;
  if (d.length === 10 && d[0] === '9') d = `7${d}`;
  return /^79\d{9}$/.test(d) ? d : null;
}

/** «79123456789» → «+7 912 345-67-89» */
export const fmtPhone = (p: string) => `+7\u00a0${p.slice(1, 4)} ${p.slice(4, 7)}-${p.slice(7, 9)}-${p.slice(9, 11)}`;

export const callConfigured = () => Boolean((process.env.SMSRU_API_ID || '').trim());
/** Тестовый режим: звонков нет, код показываем на странице. На сервере — только если явно включили TEST_MODE=1. */
export const callTestMode = () => !callConfigured() && (process.env.NODE_ENV !== 'production' || process.env.TEST_MODE === '1');
export const callAvailable = () => callConfigured() || callTestMode();

/** Номер в списке выданных пробных уроков после удаления аккаунта: храним не сам номер, а его хеш. */
export const phoneHash = (phone: string) => `h:${crypto.createHash('sha256').update(`parta-trial:${phone}`).digest('hex')}`;

const hash = (userId: string, phone: string, code: string) => crypto.createHash('sha256').update(`phone:${userId}:${phone}:${code}`).digest('hex');

/** Звонок через SMS.ru. Возвращает 4 цифры, которые увидит человек (конец номера, с которого звонят). */
async function smsruCall(phone: string, ip: string) {
  const base = (process.env.SMSRU_URL || 'https://sms.ru').replace(/\/+$/, '');
  const url = new URL(`${base}/code/call`);
  url.searchParams.set('phone', phone);
  url.searchParams.set('ip', /^[\d.:a-f]+$/i.test(ip) ? ip : '-1');
  url.searchParams.set('api_id', (process.env.SMSRU_API_ID || '').trim());
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const j = (await res.json().catch(() => ({}))) as { status?: string; code?: unknown; status_text?: string };
  const code = String(j.code ?? '');
  if (j.status !== 'OK' || !/^\d{4}$/.test(code)) throw new Error(j.status_text || `SMS.ru ответил ${res.status}`);
  return code;
}

export type CallResult = { ok: true; wait: number; devCode?: string } | { ok: false; error: string; status: number; wait?: number };

/** Звонит на номер (или в тестовом режиме просто придумывает код). */
export async function requestCall(userId: string, phone: string, ip: string): Promise<CallResult> {
  if (!callAvailable()) return { ok: false, error: 'Подтверждение телефона пока не подключено. Напишите в поддержку.', status: 503 };
  if (await one('select 1 from users where phone = $1 and id <> $2', [phone, userId]))
    return { ok: false, error: 'Этот номер уже привязан к другому аккаунту. Войдите в тот аккаунт или укажите другой номер.', status: 409 };
  const prev = await one<{ phone: string; sent_at: Date }>('select phone, sent_at from phone_codes where user_id = $1', [userId]);
  const since = prev ? (Date.now() - new Date(prev.sent_at).getTime()) / 1000 : Infinity;
  if (since < CALL_WAIT_SEC) return { ok: false, error: `Позвонить ещё раз можно через ${Math.ceil(CALL_WAIT_SEC - since)} с`, status: 429, wait: Math.ceil(CALL_WAIT_SEC - since) };
  // Звонки стоят денег — ограничиваем: на человека, на номер, на адрес и на весь сайт за сутки
  const daily = Number(process.env.PHONE_DAILY_LIMIT) || 300;
  if (
    !rateLimit(`call-user:${userId}`, 5, 864e5) ||
    !rateLimit(`call-phone:${phone}`, 4, 864e5) ||
    !rateLimit(`call-ip:${ip}`, 10, 3600e3) ||
    !rateLimit('call-all', daily, 864e5)
  )
    return { ok: false, error: 'Слишком много звонков. Попробуйте завтра или напишите в поддержку.', status: 429 };
  let code: string;
  if (callConfigured()) {
    try {
      code = await smsruCall(phone, ip);
    } catch (e) {
      console.error('[Телефон] Звонок не прошёл:', (e as Error).message);
      return { ok: false, error: 'Не получилось позвонить. Проверьте номер и попробуйте через минуту.', status: 502 };
    }
  } else {
    code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    console.log(`\n[Телефон] Звонки не подключены (SMSRU_API_ID), звонка не будет. Код для +${phone}: ${code}\n`);
  }
  await q(
    `insert into phone_codes (user_id, phone, code_hash, attempts, sent_at, expires_at) values ($1, $2, $3, 0, now(), $4)
     on conflict (user_id) do update set phone = excluded.phone, code_hash = excluded.code_hash, attempts = 0, sent_at = now(), expires_at = excluded.expires_at`,
    [userId, phone, hash(userId, phone, code), new Date(Date.now() + CODE_TTL_MIN * 60e3)],
  );
  return { ok: true, wait: CALL_WAIT_SEC, devCode: callTestMode() ? code : undefined };
}

export type CheckResult = { ok: true; phone: string } | { ok: false; error: string; status: number; gone?: boolean };

/** Проверяет 4 цифры и привязывает номер к аккаунту. */
export async function checkCall(userId: string, raw: string): Promise<CheckResult> {
  const code = raw.replace(/\D/g, '');
  const row = await one<{ phone: string; code_hash: string; attempts: number; expires_at: Date }>('select * from phone_codes where user_id = $1', [userId]);
  if (!row) return { ok: false, error: 'Сначала нажмите «Получить звонок»', status: 400, gone: true };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await q('delete from phone_codes where user_id = $1', [userId]);
    return { ok: false, error: 'Код устарел — попросите позвонить ещё раз', status: 400, gone: true };
  }
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'Слишком много попыток — попросите позвонить ещё раз', status: 400, gone: true };
  const a = Buffer.from(hash(userId, row.phone, code));
  const b = Buffer.from(row.code_hash);
  if (code.length !== 4 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await q('update phone_codes set attempts = attempts + 1 where user_id = $1', [userId]);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    return {
      ok: false,
      error: left > 0 ? `Неверные цифры. Нужны 4 последние цифры номера, с которого позвонили (осталось попыток: ${left})` : 'Неверные цифры. Попросите позвонить ещё раз',
      status: 400,
      gone: left <= 0,
    };
  }
  try {
    await q('update users set phone = $2, phone_at = now() where id = $1', [userId, row.phone]);
  } catch (e) {
    if (/unique|duplicate/i.test(String((e as Error).message)))
      return { ok: false, error: 'Этот номер уже привязан к другому аккаунту', status: 409, gone: true };
    throw e;
  }
  await q('delete from phone_codes where user_id = $1', [userId]);
  return { ok: true, phone: row.phone };
}
