import { hashPassword } from '@/lib/auth';
import { EMAIL_RE, regOwner, sendCodeResponse } from '@/lib/authflow';
import { cleanGrade } from '@/lib/brand';
import { cleanupLater } from '@/lib/codes';
import { one } from '@/lib/db';
import { body, clientIp, fail, limited, rateLimit, str } from '@/lib/http';
import { isInviteCode } from '@/lib/ids';
import { CONSENT_VERSION } from '@/lib/legal';
import { refFromCookie } from '@/lib/referral';

/** Шаг 1 регистрации: проверяем анкету и отправляем код на почту. Аккаунт появится после ввода кода. */
export async function POST(req: Request) {
  // В лимит идут только отправленные письма с кодом (ошибки в анкете не считаются): так целый класс за одним
  // роутером спокойно зарегистрируется, а засыпать чужие ящики письмами всё равно не выйдет.
  const ip = clientIp(req);
  if (limited(`reg:${ip}`, 20, 3600e3) || !rateLimit(`reg-all:${ip}`, 120, 3600e3)) return fail('Слишком много попыток, попробуйте через час', 429);
  const b = await body<{ role: string; name: string; email: string; password: string; grade: string; invite: string; consent: unknown }>(req);
  const role = b.role === 'tutor' ? 'tutor' : 'student';
  const name = str(b.name, 60).replace(/\s+/g, ' ');
  const email = str(b.email, 120).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  const grade = role === 'student' ? cleanGrade(b.grade) || null : null;
  const invite = isInviteCode(str(b.invite, 20)) ? str(b.invite, 20) : undefined;
  if (name.length < 2) return fail('Введите имя');
  if (!EMAIL_RE.test(email)) return fail('Проверьте email');
  if (password.length < 8) return fail('Пароль должен быть не короче 8 символов');
  if (password.length > 200) return fail('Слишком длинный пароль');
  // Согласие на обработку персональных данных: отдельная галочка в анкете (152-ФЗ)
  if (b.consent !== '1' && b.consent !== true)
    return fail('Отметьте согласие на обработку персональных данных (если галочки не видно, обновите страницу)');
  if (await one('select 1 from users where email = $1', [email]))
    return fail('Этот email уже зарегистрирован. Войдите или восстановите пароль.', 409);
  rateLimit(`reg:${ip}`, 20, 3600e3);
  cleanupLater();
  const owner = await regOwner();
  // Пришёл по реферальной ссылке коллеги-репетитора — запомним, кто пригласил (скидка 10% на первую оплату)
  const ref = role === 'tutor' ? ((await refFromCookie())?.id ?? undefined) : undefined;
  return sendCodeResponse(email, 'register', {
    role,
    name,
    grade,
    password_hash: hashPassword(password),
    owner,
    invite,
    ref,
    consent_at: new Date().toISOString(),
    consent_v: CONSENT_VERSION,
  });
}
