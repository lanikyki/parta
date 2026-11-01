import { getUser } from '@/lib/auth';
import { fail, json } from '@/lib/http';
import { touch, unreadTotal } from '@/lib/messages';

/** Число непрочитанных сообщений для значка в шапке. */
export async function GET() {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  touch(user.id);
  return json({ count: await unreadTotal(user) });
}
