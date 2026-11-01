import katex from 'katex';
import { ChartSpline, FileText, Highlighter, PenLine, Shapes, Sigma, Type } from 'lucide-react';
import { SectionHead } from './SectionHead';

const tex = (s: string) => katex.renderToString(s, { throwOnError: false, output: 'html' });
const d = (ms: number) => ({ '--delay': `${ms}ms` }) as React.CSSProperties;

function BoardIllustration() {
  return (
    <div className="paper relative h-[260px] overflow-hidden rounded-2xl border border-line [--cell:22px] sm:h-[300px]">
      <div className="absolute top-3 left-3 flex items-center gap-1 rounded-xl bg-white p-1 shadow-soft">
        {[PenLine, Highlighter, Shapes, Type, Sigma, ChartSpline].map((Icon, i) => (
          <span key={i} className={`grid h-8 w-8 place-items-center rounded-lg ${i === 0 ? 'bg-brand text-white' : 'text-ink-2'}`}>
            <Icon size={16} />
          </span>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        {['#0f1f1a', '#12a566', '#ff5a5f', '#2f6bff'].map((c) => (
          <span key={c} className="mx-0.5 hidden h-4 w-4 rounded-full sm:block" style={{ background: c }} />
        ))}
      </div>
      <svg viewBox="0 0 520 300" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path
          className="draw-path"
          style={{ ...d(200), '--dur': '1.4s' } as React.CSSProperties}
          d="M70 250L70 110L290 250Z"
          pathLength={1}
          fill="none"
          stroke="#12a566"
          strokeWidth="3.2"
          strokeLinejoin="round"
        />
        <path className="draw-path" style={d(1300)} d="M70 228h22v22" pathLength={1} fill="none" stroke="#12a566" strokeWidth="2.2" />
        <text className="pop-in" style={d(1500)} x="48" y="186" fontSize="20" fontStyle="italic" fill="#0a6342">a</text>
        <text className="pop-in" style={d(1650)} x="172" y="276" fontSize="20" fontStyle="italic" fill="#0a6342">b</text>
        <text className="pop-in" style={d(1800)} x="188" y="170" fontSize="20" fontStyle="italic" fill="#0a6342">c</text>
        <path
          className="draw-path"
          style={{ ...d(2700), '--dur': '0.7s' } as React.CSSProperties}
          d="M372 168C356 214 300 222 248 196"
          pathLength={1}
          fill="none"
          stroke="#ff5a5f"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path className="pop-in" style={d(3300)} d="M262 186l-15 10 17 5" fill="none" stroke="#ff5a5f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute top-[38%] right-[6%] text-[22px] text-brand-800 sm:text-[26px]">
        <span className="grow-x absolute -inset-x-2 top-[22%] bottom-[4%] rounded-md bg-sun/80" style={d(2200)} />
        <span className="write-in relative block" style={d(1900)} dangerouslySetInnerHTML={{ __html: tex('c^2 = a^2 + b^2') }} />
      </div>
    </div>
  );
}

function VideoGrid() {
  const people = [
    ['АС', 'bg-white text-brand-800', true],
    ['МК', 'bg-accent-soft text-accent-600', false],
    ['ЕВ', 'bg-sun text-ink', false],
    ['ДП', 'bg-mint-soft text-mint', false],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-2">
      {people.map(([initials, cls, speaking]) => (
        <div key={initials} className={`relative grid aspect-[4/3] place-items-center rounded-xl bg-white/10 ${speaking ? 'speaking [--ring:#ffe066]' : ''}`}>
          <span className={`grid h-12 w-12 place-items-center rounded-full text-[15px] font-semibold ${cls}`}>{initials}</span>
        </div>
      ))}
    </div>
  );
}

function PdfStack() {
  return (
    <div className="relative mx-auto h-[170px] w-[220px]">
      {[-8, 5, 0].map((r, i) => (
        <div
          key={i}
          className="absolute inset-x-4 top-2 bottom-0 rounded-xl border border-line bg-white p-3 shadow-soft"
          style={{ transform: `rotate(${r}deg) translateY(${i * 4}px)` }}
        >
          {i === 2 && (
            <>
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-accent-600">
                <FileText size={12} /> PDF · стр. 3
              </div>
              <div className="mt-3 h-2 w-4/5 rounded bg-line" />
              <div className="mt-2 h-2 w-3/5 rounded bg-line" />
              <div className="mt-2 h-2 w-2/3 rounded bg-line" />
              <svg viewBox="0 0 120 40" className="mt-2 h-8 w-full" aria-hidden="true">
                <path
                  className="draw-path"
                  style={d(500)}
                  d="M4 28c14-20 26 6 38-8s20 10 34-4 24 6 38-10"
                  pathLength={1}
                  fill="none"
                  stroke="#ff5a5f"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function AiChat() {
  return (
    <div className="grid gap-2 text-[14px] leading-snug">
      <div className="pop-in ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-tint px-3.5 py-2.5" style={d(200)}>
        Не понимаю, как найти дискриминант
      </div>
      <div className="pop-in max-w-[92%] rounded-2xl rounded-bl-md border border-line bg-white px-3.5 py-2.5" style={d(900)}>
        Смотри: <span dangerouslySetInnerHTML={{ __html: tex('D = b^2 - 4ac') }} />. Какие <i>a</i>, <i>b</i> и <i>c</i> в твоём
        уравнении?
      </div>
    </div>
  );
}

function ChatList() {
  const rows = [
    ['МК', 'Миша К.', 'Отправил фото домашки', 2, 'bg-accent-soft text-accent-600'],
    ['ЛП', 'Лиза П.', 'Можно перенести урок на 18:00?', 1, 'bg-sun text-ink'],
    ['ЕВ', 'Елена В.', 'Спасибо, всё понятно!', 0, 'bg-mint-soft text-mint'],
  ] as const;
  return (
    <ul className="grid gap-2">
      {rows.map(([initials, name, text, unread, cls], i) => (
        <li key={name} className="pop-in flex items-center gap-3 rounded-xl bg-white px-3 py-2.5" style={d(200 + i * 250)}>
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${cls}`}>{initials}</span>
          <span className="min-w-0 flex-1 text-[14px] leading-tight">
            <b className="block truncate font-medium">{name}</b>
            <span className="block truncate text-ink-3">{text}</span>
          </span>
          {unread > 0 && (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
              {unread}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Features() {
  return (
    <section id="how" className="wrap py-20 sm:py-28">
      <SectionHead
        tag="Возможности"
        title="Всё для урока — в одной вкладке браузера"
        text="Отправьте ученику ссылку: он откроет её в браузере, включит камеру — и урок начался. Скачивать ничего не нужно."
      />
      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-6">
        <article data-reveal className="card grid gap-6 p-6 sm:p-8 md:col-span-4">
          <div className="max-w-[460px]">
            <h3 className="text-2xl font-medium">Доска-тетрадь</h3>
            <p className="mt-2 text-ink-2">
              Пишите от руки и печатайте, вставляйте формулы, графики и фигуры. Все участники видят изменения сразу, а доска
              сохраняется после урока.
            </p>
          </div>
          <BoardIllustration />
        </article>
        <article data-reveal style={{ '--d': '100ms' } as React.CSSProperties} className="flex flex-col gap-6 rounded-[20px] bg-brand p-6 text-white sm:p-8 md:col-span-2">
          <div>
            <h3 className="text-2xl font-medium">Видео до 20 человек</h3>
            <p className="mt-2 text-white/80">Индивидуально или в мини-группе. Говорящий подсвечивается, можно показать экран.</p>
          </div>
          <div className="mt-auto">
            <VideoGrid />
          </div>
        </article>
        <article data-reveal className="flex flex-col gap-6 rounded-[20px] bg-accent-soft p-6 sm:p-8 md:col-span-2">
          <div>
            <h3 className="text-2xl font-medium">PDF и презентации</h3>
            <p className="mt-2 text-ink-2">Загрузите файл — страницы станут листами доски, поверх можно писать.</p>
          </div>
          <div className="mt-auto">
            <PdfStack />
          </div>
        </article>
        <article data-reveal style={{ '--d': '100ms' } as React.CSSProperties} className="card flex flex-col gap-6 p-6 sm:p-8 md:col-span-2">
          <div>
            <h3 className="text-2xl font-medium">ИИ-помощник</h3>
            <p className="mt-2 text-ink-2">Подберёт задачи и составит конспект урока, а ученику объяснит тему — подсказывает, а не решает за него.</p>
          </div>
          <div className="mt-auto">
            <AiChat />
          </div>
        </article>
        <article data-reveal style={{ '--d': '200ms' } as React.CSSProperties} className="flex flex-col gap-6 rounded-[20px] bg-tint p-6 sm:p-8 md:col-span-2">
          <div>
            <h3 className="text-2xl font-medium">Переписка с учениками</h3>
            <p className="mt-2 text-ink-2">Расписание и домашние задания можно обсудить прямо здесь. О непрочитанных сообщениях напомним письмом.</p>
          </div>
          <div className="mt-auto">
            <ChatList />
          </div>
        </article>
      </div>
    </section>
  );
}
