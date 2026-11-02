import { getUser } from '@/lib/auth';
import { one, q } from '@/lib/db';
import { clientIp, fail, json, rateLimit, readBody } from '@/lib/http';
import { uid } from '@/lib/ids';
import { lessonByCode, removedResponse } from '@/lib/lessons';

const MAX_FILE = 6_000_000;
const MAX_FILES = 300; // картинок на один урок
const MAX_TOTAL = 300_000_000; // байт на один урок

/** Проверяем «подпись» в начале файла: под видом картинки нельзя положить что-то другое. */
function looksLike(mime: string, d: Buffer) {
  const at = (sig: number[], from = 0) => sig.every((b, i) => d[from + i] === b);
  if (mime === 'image/png') return at([0x89, 0x50, 0x4e, 0x47]);
  if (mime === 'image/jpeg') return at([0xff, 0xd8, 0xff]);
  if (mime === 'image/gif') return at([0x47, 0x49, 0x46, 0x38]);
  return at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8); // webp: RIFF....WEBP
}

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!rateLimit(`asset:${clientIp(req)}`, 40, 600e3)) return fail('Слишком много картинок подряд — подождите пару минут', 429);
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  const removed = await removedResponse(lesson.id, await getUser(), lesson.owner_id);
  if (removed) return removed;
  const mime = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return fail('Можно загрузить только изображение');
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_FILE) return fail('Файл больше 6 МБ', 413);
  const used = await one<{ n: number; size: string }>(
    'select count(*)::int as n, coalesce(sum(octet_length(data)), 0)::text as size from assets where lesson_id = $1',
    [lesson.id],
  );
  if ((used?.n ?? 0) >= MAX_FILES || Number(used?.size ?? 0) >= MAX_TOTAL)
    return fail('В этом уроке уже слишком много картинок — удалите лишние с доски или создайте новый урок', 413);
  const data = await readBody(req, MAX_FILE);
  if (!data) return fail('Файл больше 6 МБ', 413);
  if (!data.length) return fail('Пустой файл');
  if (!looksLike(mime, data)) return fail('Файл повреждён или это не картинка');
  const id = uid();
  await q('insert into assets (id, lesson_id, mime, data) values ($1, $2, $3, $4)', [id, lesson.id, mime, data]);
  return json({ id, url: `/api/assets/${id}` });
}
