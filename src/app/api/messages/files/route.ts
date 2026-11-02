import { getUser } from '@/lib/auth';
import { one, q } from '@/lib/db';
import { fail, json, rateLimit, readBody } from '@/lib/http';
import { uid } from '@/lib/ids';
import { IMAGE_TYPES, MAX_FILE, type MsgFile } from '@/lib/msgfile';

const DAY_FILES = 300; // файлов в сутки на человека
const DAY_BYTES = 500_000_000; // байт в сутки на человека

/** Картинку узнаём по «подписи» в начале файла, а не по тому, что прислал браузер. */
function sniffImage(d: Buffer) {
  const at = (sig: number[], from = 0) => sig.every((b, i) => d[from + i] === b);
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Имя файла без путей и служебных символов, не длиннее 150 знаков (расширение сохраняем). */
function cleanName(raw: string | null, fallback: string) {
  let name = '';
  try {
    name = decodeURIComponent(raw || '');
  } catch {
    name = raw || '';
  }
  name = name
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/^.*[\\/]/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || name === '.' || name === '..') name = fallback;
  if (name.length > 150) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
    name = `${name.slice(0, 150 - ext.length - 1)}…${ext}`;
  }
  return name;
}

// Файлы, которые загрузили, но так и не отправили, удаляем через сутки
let swept = 0;
function sweep() {
  if (Date.now() - swept < 600e3) return;
  swept = Date.now();
  q("delete from message_files where message_id is null and created_at < now() - interval '1 day'").catch(() => {});
}

/**
 * Загрузка файла для сообщения: тело запроса — сам файл, имя — в заголовке x-file-name.
 * Файл пока ни к чему не прикреплён: его номер отправляют вместе с сообщением.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите в аккаунт', 401);
  if (!rateLimit(`msgfile:${user.id}`, 60, 600e3)) return fail('Слишком много файлов подряд — подождите пару минут', 429);
  if (Number(req.headers.get('content-length') || 0) > MAX_FILE) return fail('Файл больше 10 МБ', 413);
  const used = await one<{ n: number; size: string }>(
    "select count(*)::int as n, coalesce(sum(size), 0)::text as size from message_files where uploader_id = $1 and created_at > now() - interval '1 day'",
    [user.id],
  );
  if ((used?.n ?? 0) >= DAY_FILES || Number(used?.size ?? 0) >= DAY_BYTES) return fail('На сегодня загружено слишком много файлов — попробуйте завтра', 429);
  const data = await readBody(req, MAX_FILE);
  if (!data) return fail('Файл больше 10 МБ', 413);
  if (!data.length) return fail('Файл пустой');

  const declared = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const image = sniffImage(data);
  // Картинкой считаем только настоящую картинку; всё остальное браузер будет лишь скачивать
  const mime = image ?? (/^[a-z0-9.+-]{1,60}\/[a-z0-9.+-]{1,80}$/.test(declared) && !IMAGE_TYPES.includes(declared) ? declared : 'application/octet-stream');
  const ext = image ? `.${image.slice(6).replace('jpeg', 'jpg')}` : '';
  const name = cleanName(req.headers.get('x-file-name'), image ? `Фото${ext}` : 'Файл');
  const size = /^(\d{1,5})x(\d{1,5})$/.exec(req.headers.get('x-image-size') || '');
  const w = image && size ? Math.min(Number(size[1]), 30000) || null : null;
  const h = image && size ? Math.min(Number(size[2]), 30000) || null : null;

  const id = uid();
  await q('insert into message_files (id, uploader_id, name, mime, size, w, h, data) values ($1, $2, $3, $4, $5, $6, $7, $8)', [
    id,
    user.id,
    name,
    mime,
    data.length,
    w,
    h,
    data,
  ]);
  sweep();
  const file: MsgFile = { id, name, mime, size: data.length, ...(w && h ? { w, h } : {}) };
  return json({ file });
}
