import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { one, q } from './db';

export type Role = 'student' | 'tutor';
export type User = { id: string; role: Role; name: string; email: string; grade: string | null };

const COOKIE = 'parta_session';
const DAYS = 30;

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
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
    path: '/',
    expires,
  });
}

export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return one<User>(
    `select u.id, u.role, u.name, u.email, u.grade
       from sessions s join users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now()`,
    [token],
  );
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await q('delete from sessions where token = $1', [token]);
  jar.delete(COOKIE);
}
