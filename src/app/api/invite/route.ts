import { getUser } from '@/lib/auth';
import { body, fail, json, str } from '@/lib/http';
import { acceptInvite } from '@/lib/messages';

/** Ученик, который уже вошёл в аккаунт, принимает приглашение репетитора. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  if (user.role !== 'student') return fail('Приглашение — для учеников. Вы вошли как репетитор.', 403);
  const tutor = await acceptInvite(user, str((await body<{ code: string }>(req)).code, 20), req);
  if (!tutor) return fail('Ссылка-приглашение недействительна', 404);
  return json({ ok: true, tutor });
}
