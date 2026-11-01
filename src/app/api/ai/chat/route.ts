import { type ChatMsg, STREAM_HEADERS, TUTOR_STYLE, aiConfigured, aiStream } from '@/lib/ai';
import { getUser } from '@/lib/auth';
import { cleanGrade, gradeHint } from '@/lib/brand';
import { logEvent } from '@/lib/events';
import { body, fail, rateLimit, str } from '@/lib/http';

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail('Войдите, чтобы пользоваться помощником', 401);
  if (!aiConfigured()) return fail('ИИ-помощник ещё не подключён', 503);
  if (!rateLimit(`ai:${user.id}`, 40, 3600e3)) return fail('Лимит вопросов на час исчерпан, попробуйте позже', 429);

  const b = await body<{ messages: ChatMsg[]; grade: string; subject: string; mode: string }>(req);
  const history = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map((m) => ({ role: m.role, content: str(m.content, 4000) }) as ChatMsg)
    .filter((m) => m.content);
  if (!history.length || history[history.length - 1].role !== 'user') return fail('Пустой вопрос');

  const fast = b.mode !== 'smart';
  const grade = cleanGrade(b.grade) || cleanGrade(user.grade);
  const subject = str(b.subject, 40);
  const system = `${TUTOR_STYLE}
${grade ? gradeHint(grade) : ''}
${subject ? `Предмет: ${subject}.` : ''}
Помогай разобраться, а не списать: сначала подсказка и наводящий вопрос, решение — по шагам. Полный ответ давай, если ученик просит или уже попробовал сам.
Если вопрос не про учёбу, мягко верни разговор к учёбе.${fast ? '\nОтвечай коротко и по делу: до 6–8 предложений или до 5 шагов. Подробнее — только если попросят.' : ''}`;

  logEvent('ai_chat', { user, detail: `${subject || 'любой предмет'} · ${fast ? 'быстро' : 'подробно'}`, req });
  const stream = aiStream([{ role: 'system', content: system }, ...history], fast ? 'fast' : 'smart', {
    details: user.role === 'tutor',
    signal: req.signal,
  });
  return new Response(stream, { headers: STREAM_HEADERS });
}
