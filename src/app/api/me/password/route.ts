import { dropOtherSessions, getUser, hashPassword, verifyPassword } from '@/lib/auth';
import { one, q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { body, fail, json, limited, rateLimit } from '@/lib/http';

/** Смена пароля: нужен текущий пароль. На других устройствах после смены придётся войти заново. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  if (limited(`pwd:${user.id}`, 10, 3600e3)) return fail('Слишком много попыток, попробуйте через час', 429);
  const b = await body<{ current: string; next: string }>(req);
  const cur = typeof b.current === 'string' ? b.current : '';
  const next = typeof b.next === 'string' ? b.next : '';
  if (next.length < 8) return fail('Новый пароль должен быть не короче 8 символов');
  if (next.length > 200) return fail('Слишком длинный пароль');
  const row = await one<{ password_hash: string }>('select password_hash from users where id = $1', [user.id]);
  if (!row || !verifyPassword(cur, row.password_hash)) {
    rateLimit(`pwd:${user.id}`, 10, 3600e3);
    return fail('Текущий пароль введён неверно');
  }
  await q('update users set password_hash = $2 where id = $1', [user.id, hashPassword(next)]);
  await dropOtherSessions(user.id);
  logEvent('password_change', { user, req });
  return json({ ok: true });
}
