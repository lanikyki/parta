import { EMAIL_RE, sendCodeResponse } from '@/lib/authflow';
import { cleanupLater } from '@/lib/codes';
import { one } from '@/lib/db';
import { body, clientIp, fail, rateLimit, str } from '@/lib/http';

/** Забыли пароль, шаг 1: отправляем код на почту аккаунта. */
export async function POST(req: Request) {
  if (!rateLimit(`reset:${clientIp(req)}`, 10, 3600e3)) return fail('Слишком много попыток, попробуйте через час', 429);
  const b = await body<{ email: string }>(req);
  const email = str(b.email, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) return fail('Проверьте email');
  if (!(await one('select 1 from users where email = $1', [email])))
    return fail('Аккаунт с таким email не найден — проверьте адрес или зарегистрируйтесь', 404);
  cleanupLater();
  return sendCodeResponse(email, 'reset');
}
