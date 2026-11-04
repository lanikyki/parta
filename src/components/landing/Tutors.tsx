import { Check, Link2, ListChecks } from 'lucide-react';
import Link from 'next/link';

const POINTS = [
  'Отправьте ученику ссылку-приглашение — он сразу появится в вашем списке',
  'Переписка с каждым учеником, а о новых сообщениях напомним письмом',
  'Расписание, доски и конспекты уроков всегда под рукой',
  'ИИ подберёт задачи по теме и составит конспект урока',
];

function DashboardMock() {
  const lessons = [
    ['16:00', 'Алгебра · 9 класс', 'Миша К.', true],
    ['17:30', 'Английский язык · группа', '3 ученика', false],
    ['19:00', 'Программирование', 'Лиза П.', false],
  ] as const;
  return (
    <div className="rounded-[24px] bg-white p-4 text-ink shadow-lift sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 font-medium">Уроки на сегодня</p>
        <span className="shrink-0 rounded-full bg-tint px-3 py-1 font-mono text-[11px] whitespace-nowrap text-brand-800">3 урока</span>
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-2">
        {lessons.map(([time, title, who, live]) => (
          <li key={time} className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-line px-3 py-3 sm:gap-3 sm:px-4">
            <span className="hidden font-mono text-[13px] text-ink-3 sm:inline">{time}</span>
            <span className="min-w-0 flex-1 leading-tight">
              <b className="block truncate text-[14px] font-medium sm:text-[15px]">{title}</b>
              <span className="block truncate text-[13px] text-ink-3">
                <span className="font-mono text-[12px] sm:hidden">{time} · </span>
                {who}
              </span>
            </span>
            {live ? (
              <span className="btn btn-primary h-9 shrink-0 rounded-[10px] px-3 text-[14px] sm:px-3.5">Войти</span>
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mist text-ink-2 sm:h-auto sm:w-auto sm:px-3 sm:py-1.5 sm:text-[13px]">
                <Link2 size={16} className="sm:hidden" aria-label="Ссылка" />
                <span className="hidden sm:inline">Ссылка</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 rounded-2xl bg-accent-soft p-4">
        <p className="flex items-center gap-2 text-[14px] font-medium text-accent-600">
          <ListChecks size={16} /> ИИ-подборка задач
        </p>
        <p className="mt-1.5 text-[14px] leading-snug text-ink-2">
          Теорема Виета, 9 класс, средний уровень — 5 задач готовы, можно вставить на доску.
        </p>
      </div>
    </div>
  );
}

export function Tutors() {
  return (
    <section id="tutors" className="wrap pb-20 sm:pb-28">
      <div className="grid grid-cols-1 items-center gap-10 overflow-hidden rounded-[28px] bg-brand-950 px-5 py-12 text-white sm:rounded-[36px] sm:px-10 lg:grid-cols-2 lg:gap-14 lg:px-14 lg:py-16">
        <div data-reveal>
          <p className="tag text-accent">Кабинет репетитора</p>
          <h2 className="mt-4 text-[34px] leading-[1.08] font-medium sm:text-[44px]">Все ученики и уроки — в одном месте</h2>
          <ul className="mt-8 grid gap-3.5">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3 text-[17px] leading-snug text-white/85">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-white">
                  <Check size={14} strokeWidth={3} />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/register?role=tutor" className="btn btn-white btn-lg">
              Начать бесплатно
            </Link>
            <Link href="/login" className="btn btn-glass btn-lg">
              Войти в кабинет
            </Link>
          </div>
        </div>
        <div data-reveal style={{ '--d': '150ms' } as React.CSSProperties}>
          <DashboardMock />
        </div>
      </div>
    </section>
  );
}
