import { SectionHead } from './SectionHead';

const GRADES = [
  {
    n: '1–4',
    title: 'Начальная школа',
    text: 'Чтение, письмо, счёт и английский. Короткие уроки с игровыми заданиями, чтобы учиться было интересно.',
    tags: ['Чтение', 'Счёт', 'Английский'],
    cls: 'bg-tint',
  },
  {
    n: '5–8',
    title: 'Средняя школа',
    text: 'Закрываем пробелы и подтягиваем оценки. Готовимся к контрольным и ВПР без зубрёжки.',
    tags: ['Пробелы', 'Оценки', 'ВПР'],
    cls: 'bg-accent-soft',
  },
  {
    n: '9',
    title: 'Подготовка к ОГЭ',
    text: 'Разбираем задания по демоверсиям ФИПИ и решаем пробные варианты на время.',
    tags: ['Демоверсии', 'Пробники', 'Устное собеседование'],
    cls: 'bg-[#fff4cc]',
  },
  {
    n: '10–11',
    title: 'Подготовка к ЕГЭ',
    text: 'Профильная математика, физика, информатика, обществознание и другие. Стратегия на экзамен и сложные задачи.',
    tags: ['Профиль', 'Вторая часть', 'Стратегия'],
    cls: 'bg-brand text-white',
  },
];

export function Grades() {
  return (
    <section id="grades" className="wrap py-20 sm:py-28">
      <SectionHead tag="Для кого" title="С 1 по 11 класс — под цель каждого ученика" />
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {GRADES.map((g, i) => {
          const dark = g.cls.includes('text-white');
          return (
            <article
              key={g.n}
              data-reveal
              style={{ '--d': `${i * 90}ms` } as React.CSSProperties}
              className={`flex min-h-[340px] flex-col rounded-[24px] p-6 sm:p-7 ${g.cls}`}
            >
              <p className="flex items-baseline gap-2">
                <span className={`text-[64px] leading-none font-medium tracking-[-0.05em] ${dark ? 'text-white' : 'text-brand'}`}>{g.n}</span>
                <span className={`tag ${dark ? 'text-white/70' : 'text-ink-3'}`}>класс</span>
              </p>
              <h3 className="mt-8 text-[22px] font-medium">{g.title}</h3>
              <p className={`mt-2 leading-relaxed ${dark ? 'text-white/80' : 'text-ink-2'}`}>{g.text}</p>
              <ul className="mt-auto flex flex-wrap gap-1.5 pt-6">
                {g.tags.map((t) => (
                  <li key={t} className={`rounded-full px-3 py-1 text-[13px] ${dark ? 'bg-white/15' : 'bg-white'}`}>
                    {t}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}
