import { TUTOR_STYLE, aiComplete, aiConfigured, aiJson } from '@/lib/ai';
import { getUser } from '@/lib/auth';
import { cleanGrade, gradeFor, gradeLabel } from '@/lib/brand';
import { logEvent } from '@/lib/events';
import { body, fail, rateLimit, str } from '@/lib/http';

export async function POST(req: Request) {
  const user = await getUser();
  if (!user || user.role !== 'tutor') return fail('Доступно репетиторам', 403);
  if (!aiConfigured()) return fail('ИИ ещё не подключён: укажите AI_BASE_URL и AI_API_KEY', 503);
  if (!rateLimit(`tasks:${user.id}`, 30, 3600e3)) return fail('Слишком много запросов, попробуйте позже', 429);
  const b = await body<{ topic: string; grade: string; count: number; level: string }>(req);
  const topic = str(b.topic, 200);
  if (!topic) return fail('Укажите тему');
  const count = Math.min(10, Math.max(1, Math.round(Number(b.count) || 5)));
  const level = ['база', 'средний', 'сложный'].includes(b.level ?? '') ? b.level : 'средний';
  const grade = cleanGrade(b.grade);
  logEvent('ai_tasks', { user, detail: `${topic}${grade ? `, ${gradeLabel(grade).toLowerCase()}` : ''}`, req });
  return aiJson(req, true, async (signal) => {
    const text = await aiComplete(
      [
        { role: 'system', content: TUTOR_STYLE },
        {
          role: 'user',
          content: `Составь ${count} задач по теме «${topic}»${grade ? ` ${gradeFor(grade)}` : ''}, уровень: ${level}.
Только условия, без решений и ответов. Нумеруй: «1. …». Без вступлений и заключений.`,
        },
      ],
      'smart',
      { maxTokens: 3000, signal },
    );
    return { text };
  });
}
