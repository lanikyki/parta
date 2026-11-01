import { createSession, hashPassword } from '@/lib/auth';
import { checkCode } from '@/lib/codes';
import { one, q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { body, clientIp, fail, json, rateLimit, str } from '@/lib/http';

/** Забыли пароль, шаг 2: код из письма + новый пароль → входим с новым паролем. */
export async function POST(req: Request) {
  if (!rateLimit(`verify:${clientIp(req)}`, 40, 15 * 60e3)) return fail('Слишком много попыток, подождите 15 минут', 429);
  const b = await body<{ email: string; code: string; password: string }>(req);
  const email = str(b.email, 120).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 8) return fail('Пароль должен быть не короче 8 символов');
  if (password.length > 200) return fail('Слишком длинный пароль');
  const r = await checkCode(email, 'reset', str(b.code, 20));
  if (!r.ok) return Response.json({ error: r.error, gone: r.gone ?? false }, { status: 400 });
  const user = await one<{ id: string; name: string }>('update users set password_hash = $2 where email = $1 returning id, name', [email, hashPassword(password)]);
  if (!user) return fail('Аккаунт не найден', 404);
  // Старые входы на других устройствах больше не действуют
  await q('delete from sessions where user_id = $1', [user.id]);
  await createSession(user.id);
  logEvent('reset', { user, detail: email, req });
  return json({ ok: true });
}
