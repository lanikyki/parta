import { sendCodeResponse } from '@/lib/authflow';
import { one } from '@/lib/db';
import { body, clientIp, fail, rateLimit, str } from '@/lib/http';

/** Отправить код ещё раз (регистрация или смена пароля). */
export async function POST(req: Request) {
  if (!rateLimit(`resend:${clientIp(req)}`, 20, 3600e3)) return fail('Слишком много писем, попробуйте через час', 429);
  const b = await body<{ email: string; purpose: string }>(req);
  const email = str(b.email, 120).toLowerCase();
  const purpose = b.purpose === 'reset' ? 'reset' : 'register';
  if (purpose === 'register' && !(await one("select 1 from email_codes where email = $1 and purpose = 'register'", [email])))
    return fail('Заполните анкету регистрации ещё раз', 400);
  if (purpose === 'reset' && !(await one('select 1 from users where email = $1', [email]))) return fail('Аккаунт с таким email не найден', 404);
  return sendCodeResponse(email, purpose);
}
