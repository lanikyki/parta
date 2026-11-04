import { getUser } from '@/lib/auth';
import { AVATAR_MAX, avatarUrl } from '@/lib/avatar';
import { one, q } from '@/lib/db';
import { fail, json, rateLimit, readBody } from '@/lib/http';

/** Картинку узнаём по «подписи» в начале файла, а не по тому, что прислал браузер. */
function sniff(d: Buffer) {
  const at = (sig: number[], from = 0) => sig.every((b, i) => d[from + i] === b);
  if (at([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Новое фото профиля: тело запроса — сама картинка (браузер уже обрезал её в квадрат и уменьшил). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  if (!rateLimit(`avatar:${user.id}`, 20, 3600e3)) return fail('Слишком часто — попробуйте через час', 429);
  const data = await readBody(req, AVATAR_MAX);
  if (!data) return fail('Фото слишком большое — выберите другое', 413);
  const mime = sniff(data);
  if (!mime) return fail('Нужна картинка: JPG, PNG или WebP');
  const row = await one<{ at: Date }>(
    `with a as (insert into avatars (user_id, mime, data, updated_at) values ($1, $2, $3, now())
                on conflict (user_id) do update set mime = excluded.mime, data = excluded.data, updated_at = now() returning updated_at)
     update users set avatar_at = (select updated_at from a) where id = $1 returning avatar_at as at`,
    [user.id, mime, data],
  );
  return json({ ok: true, avatar: avatarUrl(user.id, row?.at ?? new Date()) });
}

export async function DELETE() {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  await q('delete from avatars where user_id = $1', [user.id]);
  await q('update users set avatar_at = null where id = $1', [user.id]);
  return json({ ok: true, avatar: null });
}
