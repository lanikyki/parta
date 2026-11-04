import { SectionHead } from './SectionHead';

const STEPS = [
  ['Зарегистрируйтесь', 'Нужны только имя и почта. Это бесплатно и занимает минуту.'],
  ['Создайте урок', 'Впишите предмет и отправьте ученику ссылку на урок или приглашение в ваш кабинет.'],
  ['Занимайтесь', 'Урок идёт прямо в браузере. Между уроками — переписка, а доски и конспекты сохраняются.'],
];

export function Steps() {
  return (
    <section id="start" className="wrap pb-20 sm:pb-28">
      <SectionHead tag="Как начать" title="Три шага до первого урока" />
      <ol className="relative mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
        {STEPS.map(([title, text], i) => (
          <li key={title} data-reveal style={{ '--d': `${i * 120}ms` } as React.CSSProperties} className="card relative p-6 sm:p-8 md:p-6 lg:p-8">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-brand font-mono text-[15px] text-white">
              0{i + 1}
            </span>
            <h3 className="mt-6 text-[22px] font-medium md:text-[clamp(17px,2.3vw,22px)]">{title}</h3>
            <p className="mt-2 leading-relaxed text-ink-2">{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
