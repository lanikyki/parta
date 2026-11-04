import { getUser } from '@/lib/auth';
import { endTrialIfOver, videoState } from '@/lib/billing';
import { fail, json } from '@/lib/http';
import { lessonByCode } from '@/lib/lessons';

/** Есть ли сейчас видео в уроке (после того как комнату закрыли, — почему). */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  const user = await getUser();
  const state = await videoState(lesson);
  const host = user?.id === lesson.owner_id;
  // Ученикам и гостям — только «есть видео или нет», без подробностей о тарифе репетитора
  if (!host) return json({ ok: state.ok, reason: state.ok ? null : state.reason === 'phone' || state.reason === 'trial' ? 'wait' : 'off' });
  return json(state);
}

/** Репетитор: время пробного урока вышло — закрыть видеокомнату сразу, не дожидаясь фоновой проверки. */
export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const lesson = await lessonByCode((await params).code);
  if (!lesson) return fail('Урок не найден', 404);
  const user = await getUser();
  if (user?.id !== lesson.owner_id) return fail('Только репетитор урока', 403);
  const closed = await endTrialIfOver(lesson.id);
  return json({ ok: true, closed, state: await videoState(lesson) });
}
