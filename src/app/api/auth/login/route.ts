import { createSession, verifyPassword } from '@/lib/auth';
import { cleanupLater } from '@/lib/codes';
import { one } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { acceptInvite } from '@/lib/messages';
import { body, clientIp, fail, json, limited, rateLimit, str } from '@/lib/http';

const WINDOW = 15 * 60e3;

export async function POST(req: Request) {
  const b = await body<{ email: string; password: string; invite: string }>(req);
  const email = str(b.email, 120).toLowerCase();
  const ip = clientIp(req);
  // Считаем только неудачные попытки: удачные входы не тратят лимит — иначе ученики одного класса
  // (один роутер, один адрес) или человек, который часто входит и выходит, упирались бы в «подождите 15 минут».
  // Общий потолок 300 запросов с адреса — только от совсем бешеного перебора.
  if (limited(`login-fail:${ip}:${email}`, 10, WINDOW) || limited(`login-fail-ip:${ip}`, 40, WINDOW) || !rateLimit(`login-ip:${ip}`, 300, WINDOW))
    return fail('Слишком много попыток, подождите 15 минут', 429);
  // Перебор пароля одного аккаунта с разных адресов: считаем неудачные попытки на сам email
  if (email && limited(`login-fail:${email}`, 30, WINDOW)) return fail('Слишком много неверных попыток для этого аккаунта, подождите 15 минут', 429);
  const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
  const user = await one<{ id: string; name: string; role: string; password_hash: string }>('select id, name, role, password_hash from users where email = $1', [email]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    rateLimit(`login-fail:${ip}:${email}`, 10, WINDOW);
    rateLimit(`login-fail-ip:${ip}`, 40, WINDOW);
    if (email) {
      rateLimit(`login-fail:${email}`, 30, WINDOW);
      logEvent('login_fail', { actor: email, detail: user ? 'неверный пароль' : 'нет такого аккаунта', req });
    }
    return fail('Неверный email или пароль', 401);
  }
  await createSession(user.id);
  logEvent('login', { user, req });
  if (b.invite) await acceptInvite(user, str(b.invite, 20), req);
  cleanupLater();
  return json({ ok: true });
}
