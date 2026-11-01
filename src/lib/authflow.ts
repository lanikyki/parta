import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { RESEND_SEC, type Purpose, cancelCode, issueCode } from './codes';
import { fail, json } from './http';
import { mailErrorText, sendCode } from './mail';

const dev = () => process.env.NODE_ENV !== 'production';

/**
 * Выдаёт код и отправляет письмо. Ответ для страницы: шаг «введите код»,
 * через сколько можно запросить новый код и (только на своём компьютере без почты) сам код.
 */
export async function sendCodeResponse(email: string, purpose: Purpose, payload?: unknown) {
  const r = await issueCode(email, purpose, payload);
  if ('wait' in r) return json({ ok: true, step: 'code', email, wait: r.wait, already: true });
  try {
    const sent = await sendCode(email, r.code, purpose);
    return json({ ok: true, step: 'code', email, wait: RESEND_SEC, mail: sent, devCode: !sent && dev() ? r.code : undefined });
  } catch (e) {
    await cancelCode(email, purpose);
    const why = mailErrorText(e);
    console.error(`[Почта] Письмо на ${email} не отправлено: ${why}\n        (${String((e as Error)?.message ?? e).slice(0, 300)})`);
    return fail(dev() ? `Не удалось отправить письмо: ${why}` : 'Не удалось отправить письмо с кодом. Попробуйте ещё раз через пару минут.', 502);
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Метка браузера, в котором начали регистрацию: код из письма сработает только в нём.
// Так чужой человек не сможет «подменить» анкету (и пароль), пока владелец почты вводит код.
const REG_COOKIE = 'parta_reg';
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const regCookie = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
  path: '/api/auth',
});

export async function regOwner() {
  const jar = await cookies();
  let token = jar.get(REG_COOKIE)?.value || '';
  if (!/^[0-9a-f]{32}$/.test(token)) token = crypto.randomBytes(16).toString('hex');
  jar.set(REG_COOKIE, token, { ...regCookie(), maxAge: 3600 });
  return sha(token);
}

export async function isRegOwner(owner: unknown) {
  if (typeof owner !== 'string') return true; // анкета без метки (старая версия сайта)
  const token = (await cookies()).get(REG_COOKIE)?.value || '';
  return Boolean(token) && sha(token) === owner;
}

export async function clearRegOwner() {
  (await cookies()).set(REG_COOKIE, '', { ...regCookie(), maxAge: 0 });
}
