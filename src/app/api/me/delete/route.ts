import { destroySession, getUser, verifyPassword } from '@/lib/auth';
import { one, q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { body, fail, json, limited, rateLimit } from '@/lib/http';
import { phoneHash } from '@/lib/phone';

/** Удаление аккаунта навсегда: уроки, доски, переписка и фото удаляются; записи о платежах остаются (для бухгалтерии). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  if (limited(`del:${user.id}`, 5, 3600e3)) return fail('Слишком много попыток, попробуйте через час', 429);
  const b = await body<{ password: string }>(req);
  const row = await one<{ password_hash: string }>('select password_hash from users where id = $1', [user.id]);
  if (!row || !verifyPassword(typeof b.password === 'string' ? b.password : '', row.password_hash)) {
    rateLimit(`del:${user.id}`, 5, 3600e3);
    return fail('Пароль введён неверно');
  }
  logEvent('account_delete', { user, detail: user.email, req });
  // Номер, на который был пробный урок, оставляем только хешем: чтобы пробный урок нельзя было получить повторно
  const ph = await one<{ phone: string | null }>('select phone from users where id = $1', [user.id]);
  if (ph?.phone) await q('update trials set phone = $2 where user_id = $1', [user.id, phoneHash(ph.phone)]).catch(() => {});
  await destroySession();
  await q('delete from users where id = $1', [user.id]);
  return json({ ok: true });
}
