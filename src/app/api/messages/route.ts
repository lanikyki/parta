import { getUser } from '@/lib/auth';
import { body, fail, json, rateLimit, str } from '@/lib/http';
import { cleanFileIds, cleanText, listThreads, postMessage, startThread, touch } from '@/lib/messages';

/** Список переписок (страница «Сообщения» обновляет его раз в несколько секунд). */
export async function GET() {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  touch(user.id);
  const threads = await listThreads(user);
  return json({ threads, unread: threads.reduce((n, t) => n + t.unread, 0) });
}

/** Первое сообщение: заводим переписку с учеником, репетитором или поддержкой. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  const b = await body<{ to: string; support: boolean; text: string; files: string[] }>(req);
  const text = cleanText(b.text);
  const files = cleanFileIds(b.files);
  if (!files) return fail('Можно прикрепить не больше 10 файлов');
  if (!text && !files.length) return fail('Напишите сообщение');
  if (!rateLimit(`msg:${user.id}`, 20, 60e3) || !rateLimit(`msg-day:${user.id}`, 600, 864e5))
    return fail('Слишком много сообщений подряд — подождите минуту', 429);
  const acc = await startThread(user, { to: str(b.to, 64), support: b.support === true });
  if ('error' in acc) return fail(acc.error, acc.status);
  const message = await postMessage(user, acc, text, files, req);
  if ('error' in message) return fail(message.error, message.status);
  return json({ id: acc.thread.id, message });
}
