import { one, q, withLock } from '@/lib/db';
import { body, fail, json } from '@/lib/http';
import { lessonByCode } from '@/lib/lessons';
import { type BoardSnapshot, type Item, type Page, emptyBoard, mergeInto, sanitizeSnapshot } from '@/lib/board/types';

type Ctx = { params: Promise<{ code: string }> };

async function load(lessonId: string): Promise<BoardSnapshot> {
  const row = await one<{ data: string }>('select data from boards where lesson_id = $1', [lessonId]);
  if (!row) return emptyBoard();
  try {
    return sanitizeSnapshot(JSON.parse(row.data));
  } catch {
    return emptyBoard();
  }
}

export async function GET(_req: Request, { params }: Ctx) {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  return json(await load(lesson.id));
}

/** Принимает изменения (items/pages) и сливает их с сохранённой доской по версиям. */
export async function POST(req: Request, { params }: Ctx) {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  if (Number(req.headers.get('content-length') || 0) > 8_000_000) return fail('Слишком большой объём', 413);
  const b = await body<{ items: Item[]; pages: Page[] }>(req);
  const patch = sanitizeSnapshot({
    items: Object.fromEntries((Array.isArray(b.items) ? b.items : []).map((i) => [i?.id, i])),
    pages: Object.fromEntries((Array.isArray(b.pages) ? b.pages : []).map((p) => [p?.id, p])),
  });
  if (!Array.isArray(b.pages) || !b.pages.length) patch.pages = {};
  await withLock(`board:${lesson.id}`, async () => {
    const current = await load(lesson.id);
    if (!mergeInto(current, patch)) return;
    await q(
      `insert into boards (lesson_id, data, updated_at) values ($1, $2, now())
       on conflict (lesson_id) do update set data = excluded.data, updated_at = now()`,
      [lesson.id, JSON.stringify(current)],
    );
  });
  return json({ ok: true });
}
