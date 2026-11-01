import { createSession, verifyPassword } from '@/lib/auth';
import { cleanupLater } from '@/lib/codes';
import { one } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { acceptInvite } from '@/lib/messages';
import { body, clientIp, fail, json, rateLimit, str } from '@/lib/http';

export async function POST(req: Request) {
  const b = await body<{ email: string; password: string; invite: string }>(req);
  const email = str(b.email, 120).toLowerCase();
  const ip = clientIp(req);
  if (!rateLimit(`login:${ip}:${email}`, 10, 15 * 60e3) || !rateLimit(`login-ip:${ip}`, 40, 15 * 60e3))
    return fail('Слишком много попыток, подождите 15 минут', 429);
  const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
  const user = await one<{ id: string; name: string; role: string; password_hash: string }>('select id, name, role, password_hash from users where email = $1', [email]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    if (email) logEvent('login_fail', { actor: email, detail: user ? 'неверный пароль' : 'нет такого аккаунта', req });
    return fail('Неверный email или пароль', 401);
  }
  await createSession(user.id);
  logEvent('login', { user, req });
  if (b.invite) await acceptInvite(user, str(b.invite, 20), req);
  cleanupLater();
  return json({ ok: true });
}
