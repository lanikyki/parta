import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { one, q } from './db';

export type Role = 'student' | 'tutor';
export type User = { id: string; role: Role; name: string; email: string; grade: string | null };

const COOKIE = 'parta_session';
// По https (ссылка туннеля, свой домен) — cookie с приставкой __Host-. Её не может подменить соседний адрес:
// браузер считает *.ru.tuna.am одним сайтом, и без этого чужой туннель мог бы «подсунуть» свою сессию.
const SECURE_COOKIE = '__Host-parta_session';
const DAYS = 30;
/**
 * Открыт ли сайт по https. Надёжнее всего — заголовок Origin, который браузер ставит при входе
 * (https://…tuna.am или http://localhost:3000); иначе — заголовок от туннеля или сервера.
 */
async function onHttps() {
  const h = await headers();
  const origin = h.get('origin') || '';
  if (/^https?:\/\//.test(origin)) return origin.startsWith('https://');
  if ((h.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https') return true;
  return process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1';
}

async function sessionToken() {
  const jar = await cookies();
  const secure = jar.get(SECURE_COOKIE)?.value;
  if (secure) return secure;
  // Обычную cookie по https через туннель не принимаем: её мог подсунуть соседний адрес.
  // На своём сервере с доменом (DOMAIN) — принимаем: это входы, сделанные до обновления сайта.
  if (!process.env.DOMAIN && (await onHttps())) return undefined;
  return jar.get(COOKIE)?.value;
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `s1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), 32);
  const expected = Buffer.from(hash, 'base64');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + DAYS * 864e5);
  await q('insert into sessions (token, user_id, expires_at) values ($1, $2, $3)', [token, userId, expires]);
  const https = await onHttps();
  const jar = await cookies();
  jar.set(https ? SECURE_COOKIE : COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: https, path: '/', expires });
  if (https && jar.get(COOKIE)) jar.delete(COOKIE);
}

export async function getUser(): Promise<User | null> {
  const token = await sessionToken();
  if (!token) return null;
  return one<User>(
    `select u.id, u.role, u.name, u.email, u.grade
       from sessions s join users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now()`,
    [token],
  );
}

const GUEST = 'parta_guest';
const SECURE_GUEST = '__Host-parta_guest';

/**
 * Постоянная метка гостя (без аккаунта) в этом браузере — чтобы репетитор мог удалить гостя из урока
 * и тот не вернулся по той же ссылке. create: true — выдать новую, если её ещё нет (только в обработчиках API).
 */
export async function guestId(create = false) {
  const jar = await cookies();
  const https = await onHttps();
  const have = jar.get(SECURE_GUEST)?.value || (https && !process.env.DOMAIN ? undefined : jar.get(GUEST)?.value);
  if (have && /^[A-Za-z0-9_-]{16,64}$/.test(have)) return have;
  if (!create) return null;
  const id = crypto.randomBytes(18).toString('base64url');
  jar.set(https ? SECURE_GUEST : GUEST, id, { httpOnly: true, sameSite: 'lax', secure: https, path: '/', maxAge: 365 * 864e2 });
  return id;
}

export async function destroySession() {
  const jar = await cookies();
  for (const token of [jar.get(SECURE_COOKIE)?.value, jar.get(COOKIE)?.value])
    if (token) await q('delete from sessions where token = $1', [token]);
  if (jar.get(COOKIE)) jar.delete(COOKIE);
  // __Host- cookie браузер удалит, только если и команда на удаление помечена как Secure
  if (jar.get(SECURE_COOKIE)) jar.set(SECURE_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 0 });
}
