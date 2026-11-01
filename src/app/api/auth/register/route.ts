import { hashPassword } from '@/lib/auth';
import { EMAIL_RE, regOwner, sendCodeResponse } from '@/lib/authflow';
import { cleanGrade } from '@/lib/brand';
import { cleanupLater } from '@/lib/codes';
import { one } from '@/lib/db';
import { body, clientIp, fail, rateLimit, str } from '@/lib/http';
import { isInviteCode } from '@/lib/ids';

/** Шаг 1 регистрации: проверяем анкету и отправляем код на почту. Аккаунт появится после ввода кода. */
export async function POST(req: Request) {
  if (!rateLimit(`reg:${clientIp(req)}`, 15, 3600e3)) return fail('Слишком много попыток, попробуйте через час', 429);
  const b = await body<{ role: string; name: string; email: string; password: string; grade: string; invite: string }>(req);
  const role = b.role === 'tutor' ? 'tutor' : 'student';
  const name = str(b.name, 60).replace(/\s+/g, ' ');
  const email = str(b.email, 120).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  const grade = role === 'student' ? cleanGrade(b.grade) || null : null;
  const invite = isInviteCode(str(b.invite, 20)) ? str(b.invite, 20) : undefined;
  if (name.length < 2) return fail('Введите имя');
  if (!EMAIL_RE.test(email)) return fail('Проверьте email');
  if (password.length < 8) return fail('Пароль должен быть не короче 8 символов');
  if (password.length > 200) return fail('Слишком длинный пароль');
  if (await one('select 1 from users where email = $1', [email]))
    return fail('Этот email уже зарегистрирован. Войдите или восстановите пароль.', 409);
  cleanupLater();
  const owner = await regOwner();
  return sendCodeResponse(email, 'register', { role, name, grade, password_hash: hashPassword(password), owner, invite });
}
