import { getUser } from '@/lib/auth';
import { body, fail, json, rateLimit } from '@/lib/http';
import { cleanFileIds, cleanText, openThread, postMessage, threadMessages, touch } from '@/lib/messages';

type Ctx = { params: Promise<{ id: string }> };
const num = (v: string | null) => Math.max(0, Math.floor(Number(v) || 0));

/** Сообщения переписки: ?after=N — только новые, ?before=N — более ранние. */
export async function GET(req: Request, { params }: Ctx) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  const acc = await openThread(user, (await params).id);
  if (!acc) return fail('Переписка не найдена', 404);
  touch(user.id);
  const sp = new URL(req.url).searchParams;
  return json(await threadMessages(user, acc, { after: num(sp.get('after')), before: num(sp.get('before')) }));
}

/** Новое сообщение: текст и/или заранее загруженные файлы ({ text, files: [id…] }). */
export async function POST(req: Request, { params }: Ctx) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  const acc = await openThread(user, (await params).id);
  if (!acc) return fail('Переписка не найдена', 404);
  const b = await body<{ text: string; files: string[] }>(req);
  const text = cleanText(b.text);
  const files = cleanFileIds(b.files);
  if (!files) return fail('Можно прикрепить не больше 10 файлов');
  if (!text && !files.length) return fail('Напишите сообщение');
  if (!rateLimit(`msg:${user.id}`, 20, 60e3) || !rateLimit(`msg-day:${user.id}`, 600, 864e5))
    return fail('Слишком много сообщений подряд — подождите минуту', 429);
  const message = await postMessage(user, acc, text, files, req);
  if ('error' in message) return fail(message.error, message.status);
  return json({ message });
}
