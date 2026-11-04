import { runAutorenew, runPendingSync, runReminders, runTrialSweep } from './billing';

// Фоновые задачи сайта. Запускаются сами вместе с базой (в том же процессе) и работают, пока работает сайт.
// Раз в 30 секунд — конец пробных уроков; раз в 5 минут — автопродление, напоминания и сверка зависших платежей.

const g = globalThis as { __partaJobs?: boolean };
let tick = 0;
let busy = false;

async function run() {
  if (busy) return;
  busy = true;
  try {
    await runTrialSweep();
    if (tick++ % 10 === 0) {
      await runPendingSync();
      await runAutorenew();
      await runReminders();
    }
  } catch (e) {
    console.error('[Фоновые задачи]', (e as Error).message);
  } finally {
    busy = false;
  }
}

export function startJobs() {
  if (g.__partaJobs || process.env.NEXT_PHASE === 'phase-production-build' || process.env.PARTA_NO_JOBS === '1') return;
  g.__partaJobs = true;
  setTimeout(run, 5_000).unref?.();
  setInterval(run, 30_000).unref?.();
}
