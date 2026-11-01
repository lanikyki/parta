import crypto from 'node:crypto';
import { one, q } from './db';

// Одноразовые коды из писем: регистрация и смена пароля.
export type Purpose = 'register' | 'reset';

export const CODE_TTL_MIN = 15;
export const RESEND_SEC = 60;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

type Row = { code_hash: string; payload: string | null; attempts: number; sends: number; first_sent_at: Date; sent_at: Date; expires_at: Date };

const ownerOf = (p: unknown) => {
  try {
    const v = (typeof p === 'string' ? JSON.parse(p) : p) as { owner?: unknown } | null;
    return typeof v?.owner === 'string' ? v.owner : undefined;
  } catch {
    return undefined;
  }
};

const hash = (email: string, purpose: Purpose, code: string) => crypto.createHash('sha256').update(`${purpose}:${email}:${code}`).digest('hex');
const ms = (d: Date | string) => new Date(d).getTime();

/** Новый код (или сколько секунд подождать, если код только что отправляли). */
export async function issueCode(email: string, purpose: Purpose, payload?: unknown): Promise<{ code: string } | { wait: number }> {
  const row = await one<Row>('select * from email_codes where email = $1 and purpose = $2', [email, purpose]);
  const now = Date.now();
  if (row) {
    const since = (now - ms(row.sent_at)) / 1000;
    const inHour = now - ms(row.first_sent_at) < 3600e3;
    let wait = since < RESEND_SEC ? Math.ceil(RESEND_SEC - since) : 0;
    if (!wait && inHour && row.sends >= MAX_SENDS_PER_HOUR) wait = Math.ceil((ms(row.first_sent_at) + 3600e3 - now) / 1000);
    if (wait) {
      // Пока ждём новый код, старый продолжает действовать — обновим только данные анкеты,
      // и только если их прислал тот же браузер, что и в первый раз
      const before = ownerOf(row.payload);
      if (payload !== undefined && (!before || before === ownerOf(payload)))
        await q('update email_codes set payload = $3 where email = $1 and purpose = $2', [email, purpose, JSON.stringify(payload)]);
      return { wait };
    }
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const fresh = !row || now - ms(row.first_sent_at) >= 3600e3;
  await q(
    `insert into email_codes (email, purpose, code_hash, payload, attempts, sends, first_sent_at, sent_at, expires_at)
     values ($1, $2, $3, $4, 0, $5, $6, now(), $7)
     on conflict (email, purpose) do update set code_hash = excluded.code_hash, payload = coalesce(excluded.payload, email_codes.payload),
       attempts = 0, sends = excluded.sends, first_sent_at = excluded.first_sent_at, sent_at = now(), expires_at = excluded.expires_at`,
    [
      email,
      purpose,
      hash(email, purpose, code),
      payload === undefined ? null : JSON.stringify(payload),
      fresh ? 1 : row!.sends + 1,
      fresh ? new Date() : row!.first_sent_at,
      new Date(now + CODE_TTL_MIN * 60e3),
    ],
  );
  return { code };
}

/** Письмо не ушло — даём запросить код заново сразу. */
export async function cancelCode(email: string, purpose: Purpose) {
  await q("update email_codes set sent_at = now() - interval '1 hour', sends = greatest(sends - 1, 0) where email = $1 and purpose = $2", [email, purpose]);
}

/** Проверяет код. Верный код сразу удаляется (второй раз им не воспользоваться). */
export async function checkCode(
  email: string,
  purpose: Purpose,
  code: string,
): Promise<{ ok: true; payload: unknown } | { ok: false; error: string; gone?: boolean }> {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 6) return { ok: false, error: 'Введите 6 цифр из письма' };
  const used = await one<{ payload: string | null }>(
    `delete from email_codes where email = $1 and purpose = $2 and code_hash = $3 and expires_at > now() and attempts < $4 returning payload`,
    [email, purpose, hash(email, purpose, digits), MAX_ATTEMPTS],
  );
  if (used) {
    try {
      return { ok: true, payload: used.payload ? JSON.parse(used.payload) : null };
    } catch {
      return { ok: true, payload: null };
    }
  }
  const row = await one<Row>('select * from email_codes where email = $1 and purpose = $2', [email, purpose]);
  if (!row || ms(row.expires_at) < Date.now()) return { ok: false, gone: true, error: 'Код устарел — нажмите «Отправить код ещё раз»' };
  const left = MAX_ATTEMPTS - row.attempts - 1;
  await q('update email_codes set attempts = attempts + 1 where email = $1 and purpose = $2', [email, purpose]);
  if (left <= 0) return { ok: false, gone: true, error: 'Слишком много неверных попыток — запросите новый код' };
  return { ok: false, error: `Неверный код. Осталось попыток: ${left}` };
}

/** Раз в час убираем просроченные коды и сессии. */
let lastCleanup = 0;
export function cleanupLater() {
  if (Date.now() - lastCleanup < 3600e3) return;
  lastCleanup = Date.now();
  q("delete from email_codes where expires_at < now() - interval '1 day'").catch(() => {});
  q('delete from sessions where expires_at < now()').catch(() => {});
}
