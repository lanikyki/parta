import { isAdmin } from '@/lib/admin';
import { getUser } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import { fail, json, rateLimit } from '@/lib/http';
import { letter, mailConfigured, mailErrorText, sendMail } from '@/lib/mail';

/** Кнопка в админке: отправить проверочное письмо себе. */
export async function POST() {
  const user = await getUser();
  if (!user || !isAdmin(user)) return fail('Нет доступа', 403);
  if (!mailConfigured())
    return fail('Почта не настроена: впишите SMTP_USER и SMTP_PASS в .env.local и перезапустите сайт (README, раздел «Почта»).', 400);
  if (!rateLimit(`test-mail:${user.id}`, 5, 10 * 60e3)) return fail('Подождите несколько минут перед следующей проверкой', 429);
  const l = letter({
    lines: ['Здравствуйте!', `Это проверочное письмо с сайта «${BRAND.name}». Если вы его читаете — почта настроена правильно: коды подтверждения и уведомления о сообщениях будут доходить.`],
  });
  try {
    await sendMail(user.email, `Проверка почты — ${BRAND.name}`, l.text, l.html);
    return json({ ok: true, to: user.email });
  } catch (e) {
    console.error('[Почта] Проверочное письмо не отправлено:', mailErrorText(e));
    return fail(`Письмо не отправлено: ${mailErrorText(e)}`, 502);
  }
}
