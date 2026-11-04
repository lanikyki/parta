import { GraduationCap, Presentation, UserRound, Users } from 'lucide-react';
import { SectionHead } from './SectionHead';

const CARDS = [
  {
    Icon: Presentation,
    title: 'Репетиторам',
    text: 'Уроки, ученики, материалы и переписка — в одном кабинете вместо нескольких разных программ.',
    tags: ['Любой предмет', 'Свои ученики', 'Переписка'],
    cls: 'bg-tint',
  },
  {
    Icon: UserRound,
    title: 'Ученикам и родителям',
    text: 'Чтобы попасть на урок, хватит ссылки от репетитора. С аккаунтом в кабинете остаются доски, конспекты и переписка.',
    tags: ['Вход по ссылке', 'Конспекты', 'Без установки'],
    cls: 'bg-accent-soft',
  },
  {
    Icon: GraduationCap,
    title: 'Любому возрасту',
    text: 'Дошкольники, школьники, студенты и взрослые. ИИ-помощник объясняет с учётом уровня ученика.',
    tags: ['Школьники', 'Студенты', 'Взрослые'],
    cls: 'bg-[#fff4cc]',
  },
  {
    Icon: Users,
    title: 'Мини-группам',
    text: 'До 20 участников на уроке. Общая доска, показ экрана, а писать на доске можно тем, кому разрешит репетитор.',
    tags: ['До 20 человек', 'Общая доска', 'Показ экрана'],
    cls: 'bg-brand text-white',
  },
];

export function Audience() {
  return (
    <section id="for" className="wrap pb-20 sm:pb-28">
      <SectionHead tag="Для кого" title="Индивидуально и в группе, для любого возраста" />
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map(({ Icon, title, text, tags, cls }, i) => {
          const dark = cls.includes('text-white');
          return (
            <article
              key={title}
              data-reveal
              style={{ '--d': `${i * 90}ms` } as React.CSSProperties}
              className={`flex min-h-[320px] flex-col rounded-[24px] p-6 sm:p-7 ${cls}`}
            >
              <span className={`grid h-14 w-14 place-items-center rounded-2xl ${dark ? 'bg-white/15 text-white' : 'bg-white text-brand'}`}>
                <Icon size={26} />
              </span>
              <h3 className="mt-8 text-[22px] font-medium">{title}</h3>
              <p className={`mt-2 leading-relaxed ${dark ? 'text-white/80' : 'text-ink-2'}`}>{text}</p>
              <ul className="mt-auto flex flex-wrap gap-1.5 pt-6">
                {tags.map((t) => (
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
