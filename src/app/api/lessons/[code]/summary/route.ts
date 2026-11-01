import { TUTOR_STYLE, aiComplete, aiConfigured, aiJson } from '@/lib/ai';
import { getUser } from '@/lib/auth';
import { one, q } from '@/lib/db';
import { logEvent } from '@/lib/events';
import { body, fail, rateLimit, str } from '@/lib/http';
import { lessonByCode } from '@/lib/lessons';
import { type Item, sanitizeSnapshot } from '@/lib/board/types';

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  const user = await getUser();
  if (!user || user.id !== lesson.owner_id) return fail('Итоги может подвести только репетитор урока', 403);
  if (!aiConfigured()) return fail('ИИ ещё не подключён: укажите AI_BASE_URL и AI_API_KEY', 503);
  if (!rateLimit(`summary:${user.id}`, 20, 3600e3)) return fail('Слишком много запросов, попробуйте позже', 429);
  const b = await body<{ notes: string }>(req);

  const chat = await q<{ author: string; text: string }>(
    'select author, text from chat_messages where lesson_id = $1 order by created_at asc limit 200',
    [lesson.id],
  );
  const row = await one<{ data: string }>('select data from boards where lesson_id = $1', [lesson.id]);
  const items = row ? (Object.values(sanitizeSnapshot(JSON.parse(row.data)).items) as Item[]) : [];
  const boardText = items
    .filter((i) => !i.deleted)
    .map((i) => (i.type === 'text' ? i.text : i.type === 'graph' ? `График: ${i.exprs.join('; ')}` : ''))
    .filter(Boolean)
    .join('\n')
    .slice(0, 6000);

  const material = [
    `Урок: ${lesson.title}${lesson.subject ? ` (${lesson.subject})` : ''}`,
    str(b.notes, 3000) && `Заметки репетитора:\n${str(b.notes, 3000)}`,
    boardText && `Записи на доске:\n${boardText}`,
    chat.length && `Чат урока:\n${chat.map((m) => `${m.author}: ${m.text}`).join('\n').slice(0, 6000)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  logEvent('ai_summary', { user, detail: lesson.title, req });
  return aiJson(req, true, async (signal) => {
    const summary = await aiComplete(
      [
        { role: 'system', content: TUTOR_STYLE },
        {
          role: 'user',
          content: `Составь короткий конспект урока для ученика и родителей по материалам ниже.
Разделы: «Что прошли», «Главное запомнить» (правила и формулы), «Получилось хорошо», «Над чем поработать», «Домашнее задание» (3–5 пунктов).
Опирайся только на материалы, ничего не выдумывай. Если данных мало — напиши кратко.

${material}`,
        },
      ],
      'smart',
      { signal },
    );
    await q('update lessons set summary = $1, summary_at = now() where id = $2', [summary, lesson.id]);
    return { summary };
  });
}
