import katex from 'katex';
import {
  ChartSpline,
  Highlighter,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MousePointer2,
  PenLine,
  PhoneOff,
  Shapes,
  Sigma,
  Type,
  Users,
  Video,
  CircleCheck,
} from 'lucide-react';
import { AvatarStudent, AvatarTutor } from './Avatar';

const tex = (s: string) => katex.renderToString(s, { throwOnError: false, output: 'html' });

const d = (ms: number) => ({ '--delay': `${ms}ms` }) as React.CSSProperties;

/** Анимированный макет урока: доска рисует параболу, участники на видео, чат. */
export function LessonMock() {
  const tools = [MousePointer2, PenLine, Highlighter, Shapes, Type, Sigma, ChartSpline];
  return (
    <div className="relative w-full [container-type:inline-size]" aria-label="Пример урока: доска с графиком, видео и чат" role="img">
      <div className="overflow-hidden rounded-[3.2cqw] bg-white text-ink shadow-[0_30px_80px_-20px_rgb(4_40_28/0.5)]">
        {/* Верхняя панель */}
        <div className="flex h-[8cqw] items-center gap-[2cqw] border-b border-line px-[3cqw]">
          <span className="inline-flex items-center gap-[1cqw] rounded-full bg-mint-soft px-[1.8cqw] py-[0.7cqw] text-[max(9px,2.1cqw)] font-medium text-mint">
            <span className="animate-blink h-[1.3cqw] w-[1.3cqw] rounded-full bg-mint" />
            Идёт урок
          </span>
          <span className="truncate text-[max(10px,2.5cqw)] font-medium">Алгебра · 9 класс</span>
          <span className="ml-auto font-mono text-[max(9px,2.1cqw)] text-ink-3">24:15</span>
        </div>

        <div className="flex">
          {/* Доска */}
          <div className="paper relative h-[58cqw] w-[73cqw] [--cell:3.4cqw]">
            <div className="absolute top-1/2 left-[2cqw] flex -translate-y-1/2 flex-col gap-[0.6cqw] rounded-[2cqw] bg-white p-[0.8cqw] shadow-soft">
              {tools.map((Icon, i) => (
                <span
                  key={i}
                  className={`grid h-[5.4cqw] w-[5.4cqw] place-items-center rounded-[1.3cqw] ${i === 1 ? 'bg-brand text-white' : 'text-ink-2'}`}
                >
                  <Icon className="h-[2.9cqw] w-[2.9cqw]" strokeWidth={2} />
                </span>
              ))}
            </div>

            <div className="absolute top-[6cqw] left-[11.5cqw] grid gap-[3.2cqw] text-[3cqw] text-brand-800">
              <div className="write-in flex items-center gap-[1.2cqw]" style={d(2300)}>
                <span className="h-[0.6cqw] w-[3cqw] rounded-full bg-accent" />
                <span dangerouslySetInnerHTML={{ __html: tex('y = x^2 - 4') }} />
              </div>
              <div className="write-in" style={d(2900)} dangerouslySetInnerHTML={{ __html: tex('x^2 - 4 = 0') }} />
              <div className="relative w-fit">
                <span className="grow-x absolute -inset-x-[1cqw] top-[18%] bottom-[8%] rounded-[0.8cqw] bg-sun/80" style={d(4200)} />
                <span className="write-in relative block" style={d(3500)} dangerouslySetInnerHTML={{ __html: tex('x_{1,2} = \\pm 2') }} />
              </div>
            </div>

            <svg viewBox="0 0 240 300" className="absolute top-[2cqw] right-[1.5cqw] h-[54cqw] w-[43cqw]" aria-hidden="true">
              <defs>
                <marker id="ax" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M1 1l8 4-8 4" fill="none" stroke="#778982" strokeWidth="1.6" strokeLinecap="round" />
                </marker>
              </defs>
              <g className="pop-in" style={d(300)}>
                <path d="M8 160H232" stroke="#778982" strokeWidth="1.6" markerEnd="url(#ax)" />
                <path d="M120 288V14" stroke="#778982" strokeWidth="1.6" markerEnd="url(#ax)" />
                {[-4, -3, -2, -1, 1, 2, 3, 4].map((k) => (
                  <path key={k} d={`M${120 + k * 22} 156v8`} stroke="#778982" strokeWidth="1.4" />
                ))}
                <text x="226" y="178" fontSize="13" fill="#778982" fontStyle="italic">x</text>
                <text x="128" y="20" fontSize="13" fill="#778982" fontStyle="italic">y</text>
              </g>
              <path
                className="draw-path"
                style={{ ...d(900), '--dur': '1.5s' } as React.CSSProperties}
                d="M49.6 66.4Q120 373.6 190.4 66.4"
                pathLength={1}
                fill="none"
                stroke="#ff5a5f"
                strokeWidth="3.4"
                strokeLinecap="round"
              />
              <circle className="pop-in" style={d(2400)} cx="76" cy="160" r="5.5" fill="#12a566" stroke="#fff" strokeWidth="2" />
              <circle className="pop-in" style={d(2550)} cx="164" cy="160" r="5.5" fill="#12a566" stroke="#fff" strokeWidth="2" />
              <text className="pop-in" style={d(2600)} x="66" y="182" fontSize="12" fill="#0a6342">−2</text>
              <text className="pop-in" style={d(2700)} x="160" y="182" fontSize="12" fill="#0a6342">2</text>
              <g className="laser">
                <circle r="9" fill="#ff5a5f" opacity=".22">
                  <animateMotion dur="6s" begin="4.5s" repeatCount="indefinite" keyPoints="0;1;0" keyTimes="0;0.5;1" calcMode="linear" path="M49.6 66.4Q120 373.6 190.4 66.4" />
                </circle>
                <circle r="3.6" fill="#ff3b45">
                  <animateMotion dur="6s" begin="4.5s" repeatCount="indefinite" keyPoints="0;1;0" keyTimes="0;0.5;1" calcMode="linear" path="M49.6 66.4Q120 373.6 190.4 66.4" />
                </circle>
              </g>
            </svg>

            {/* Курсор ученика */}
            <div className="pop-in absolute top-[38cqw] left-[27cqw]" style={d(3900)}>
              <div className="animate-floaty flex items-start">
                <MousePointer2 className="h-[3.4cqw] w-[3.4cqw] fill-accent text-accent" strokeWidth={1.5} />
                <span className="mt-[2.4cqw] -ml-[0.6cqw] rounded-full bg-accent px-[1.4cqw] py-[0.4cqw] text-[max(9px,1.9cqw)] font-medium text-white">
                  Миша
                </span>
              </div>
            </div>

            <span className="absolute bottom-[1.6cqw] left-[11.5cqw] font-mono text-[max(8px,1.7cqw)] text-ink-3">Лист 2 из 4</span>
          </div>

          {/* Видео и чат */}
          <div className="flex w-[27cqw] flex-col gap-[1.6cqw] border-l border-line bg-mist p-[1.8cqw]">
            <div className="speaking relative aspect-[4/3] overflow-hidden rounded-[1.6cqw]">
              <AvatarTutor className="h-full w-full" />
              <span className="absolute bottom-[0.9cqw] left-[0.9cqw] rounded-full bg-ink/70 px-[1.2cqw] py-[0.3cqw] text-[max(9px,1.7cqw)] text-white">
                Анна С.
              </span>
            </div>
            <div className="relative aspect-[4/3] overflow-hidden rounded-[1.6cqw]">
              <AvatarStudent className="h-full w-full" />
              <span className="absolute bottom-[0.9cqw] left-[0.9cqw] inline-flex items-center gap-[0.5cqw] rounded-full bg-ink/70 px-[1.2cqw] py-[0.3cqw] text-[max(9px,1.7cqw)] text-white">
                <MicOff className="h-[1.7cqw] w-[1.7cqw] text-accent" /> Миша
              </span>
            </div>
            <div className="mt-auto grid gap-[1cqw] text-[max(9px,1.9cqw)] leading-snug">
              <div className="pop-in w-fit max-w-full rounded-[1.4cqw] rounded-bl-[0.4cqw] bg-white px-[1.4cqw] py-[0.9cqw] shadow-soft" style={d(4400)}>
                <b className="block font-medium text-accent-600">Миша</b>Корни −2 и 2!
              </div>
              <div className="pop-in ml-auto w-fit max-w-full rounded-[1.4cqw] rounded-br-[0.4cqw] bg-brand px-[1.4cqw] py-[0.9cqw] text-white" style={d(5200)}>
                Верно! Где вершина?
              </div>
            </div>
          </div>
        </div>

        {/* Нижняя панель */}
        <div className="flex h-[9cqw] items-center justify-between border-t border-line px-[3cqw]">
          <span className="inline-flex items-center gap-[0.8cqw] text-[max(9px,2cqw)] text-ink-3">
            <Users className="h-[2.6cqw] w-[2.6cqw]" /> 2
          </span>
          <div className="flex items-center gap-[1.2cqw]">
            {[Mic, Video, MonitorUp, MessageSquare].map((Icon, i) => (
              <span key={i} className="grid h-[5.8cqw] w-[5.8cqw] place-items-center rounded-full bg-tint text-brand-800">
                <Icon className="h-[2.7cqw] w-[2.7cqw]" />
              </span>
            ))}
            <span className="grid h-[5.8cqw] w-[9cqw] place-items-center rounded-full bg-danger text-white">
              <PhoneOff className="h-[2.7cqw] w-[2.7cqw]" />
            </span>
          </div>
          <span className="font-mono text-[max(9px,2cqw)] text-ink-3">HD</span>
        </div>
      </div>

      {/* Уведомление о конспекте */}
      <div
        className="pop-in absolute -bottom-[5cqw] -left-[3cqw] hidden items-center sm:flex gap-[1.6cqw] rounded-[2cqw] bg-white px-[2.4cqw] py-[1.8cqw] text-ink shadow-lift"
        style={d(5800)}
      >
        <span className="grid h-[5.4cqw] w-[5.4cqw] place-items-center rounded-full bg-mint-soft text-mint">
          <CircleCheck className="h-[3cqw] w-[3cqw]" />
        </span>
        <span className="text-[max(10px,2.2cqw)] leading-tight">
          <b className="block font-semibold">Конспект сохранён</b>
          <span className="text-ink-3">в личном кабинете</span>
        </span>
      </div>
    </div>
  );
}
