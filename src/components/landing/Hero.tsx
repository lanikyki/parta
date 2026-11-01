import { Check } from 'lucide-react';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { LessonMock } from './LessonMock';

const CHIPS = ['Без установки программ', 'Любой предмет', 'Ученику хватит ссылки'];

export function Hero({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="wrap pt-2 pb-6">
      <div className="relative overflow-hidden rounded-[28px] bg-brand text-white sm:rounded-[36px]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgb(255_255_255/0.07)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.07)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_70%_40%,#000_10%,transparent_75%)]"
        />
        <div className="relative grid grid-cols-1 items-center gap-12 px-5 pt-9 pb-14 sm:px-10 sm:pt-14 lg:px-14 xl:grid-cols-2 xl:gap-12 xl:py-16">
          <div>
            <p className="tag text-white/70">{BRAND.tagline}</p>
            <h1 className="mt-5 text-[35px] leading-[1.06] font-medium sm:text-[60px] xl:text-[56px]">
              Онлайн-уроки <br />
              за{' '}
              <span className="relative inline-block whitespace-nowrap">
                одной партой
                <svg
                  aria-hidden="true"
                  viewBox="0 0 300 24"
                  preserveAspectRatio="none"
                  className="write-in absolute -bottom-[0.14em] left-0 h-[0.26em] w-full"
                  style={{ '--delay': '500ms', '--dur': '0.8s' } as React.CSSProperties}
                >
                  <path
                    d="M4 16C70 7 160 5 296 11"
                    fill="none"
                    stroke="#ff5a5f"
                    strokeWidth="7"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </span>
            </h1>
            <p className="mt-6 max-w-[33rem] text-lg leading-relaxed text-white/85 sm:text-xl">
              Видеосвязь, общая доска-тетрадь, презентации и переписка с учениками — в одной вкладке браузера. Для любого
              предмета: от математики и английского до программирования и музыки.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={loggedIn ? '/dashboard' : '/register?role=tutor'} className="btn btn-white btn-lg">
                {loggedIn ? 'Перейти в кабинет' : 'Начать бесплатно'}
              </Link>
              <a href="#how" className="btn btn-glass btn-lg">
                Как это работает
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-2">
              {CHIPS.map((c) => (
                <li key={c} className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3.5 py-2 text-[14px] text-white/90">
                  <Check size={15} strokeWidth={2.5} className="text-sun" /> {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto w-full max-w-[640px] xl:max-w-none">
            <LessonMock />
          </div>
        </div>
      </div>
    </section>
  );
}
