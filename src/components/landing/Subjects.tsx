import {
  Atom,
  Blocks,
  Calculator,
  Code2,
  Dna,
  FlaskConical,
  Globe,
  GraduationCap,
  Landmark,
  Languages,
  Music,
  Palette,
  PenLine,
  Scale,
} from 'lucide-react';
import { SectionHead } from './SectionHead';

const ROW_1 = [
  ['Математика', Calculator],
  ['Английский язык', Languages],
  ['Русский язык', PenLine],
  ['Программирование', Code2],
  ['Физика', Atom],
  ['Музыка', Music],
  ['Химия', FlaskConical],
] as const;
const ROW_2 = [
  ['Подготовка к школе', Blocks],
  ['Испанский язык', Globe],
  ['Биология', Dna],
  ['Рисование', Palette],
  ['История', Landmark],
  ['Подготовка к экзаменам', GraduationCap],
  ['Обществознание', Scale],
] as const;

function Row({ items, reverse = false }: { items: typeof ROW_1 | typeof ROW_2; reverse?: boolean }) {
  const list = [...items, ...items, ...items, ...items];
  return (
    <div className="marquee fade-edges overflow-hidden">
      <ul
        className="animate-marquee flex w-max gap-3 py-1.5"
        style={{ animationDirection: reverse ? 'reverse' : 'normal', '--speed': reverse ? '56s' : '46s' } as React.CSSProperties}
      >
        {list.map(([name, Icon], i) => (
          <li
            key={i}
            aria-hidden={i >= items.length || undefined}
            className="inline-flex items-center gap-3 rounded-full border border-line bg-white py-2.5 pr-6 pl-2.5 text-[17px] font-medium shadow-soft"
          >
            <span className={`grid h-10 w-10 place-items-center rounded-full ${i % 3 === 0 ? 'bg-tint text-brand' : i % 3 === 1 ? 'bg-accent-soft text-accent-600' : 'bg-mist text-brand-800'}`}>
              <Icon size={19} />
            </span>
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Subjects() {
  return (
    <section id="subjects" className="overflow-hidden bg-mist py-20 sm:py-28">
      <div className="wrap">
        <SectionHead
          tag="Предметы"
          title="Подходит для любого предмета"
          text="Школьные предметы, иностранные языки, программирование, музыка — предмет урока можно вписать любой. Доска, видео и показ экрана подойдут под ваш формат."
        />
      </div>
      <div data-reveal className="mt-12 grid gap-3">
        <Row items={ROW_1} />
        <Row items={ROW_2} reverse />
      </div>
    </section>
  );
}
