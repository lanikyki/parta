import { Check } from 'lucide-react';
import Link from 'next/link';
import { LeadForm } from './LeadForm';

const POINTS = ['Бесплатно', 'Без установки программ', 'Ученику хватит ссылки'];

export function Lead({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section id="lead" className="wrap pb-20 sm:pb-28">
      <div className="relative grid grid-cols-1 gap-10 overflow-hidden rounded-[28px] bg-brand px-6 py-12 text-white sm:rounded-[36px] sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14 lg:px-14 lg:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgb(255_255_255/0.07)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.07)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_20%_30%,#000_10%,transparent_70%)]"
        />
        <div data-reveal className="relative">
          <p className="tag text-white/70">Попробуйте</p>
          <h2 className="mt-4 text-[38px] leading-[1.05] font-medium sm:text-[52px]">Проведите первый урок уже сегодня</h2>
          <p className="mt-5 max-w-[30rem] text-lg leading-relaxed text-white/85">
            Зарегистрируйтесь, создайте урок и отправьте ученику ссылку — на всё уйдёт пара минут.
          </p>
          <ul className="mt-8 grid gap-3 text-[17px] text-white/90">
            {POINTS.map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-white/15">
                  <Check size={14} strokeWidth={3} className="text-sun" />
                </span>
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href={loggedIn ? '/dashboard' : '/register?role=tutor'} className="btn btn-white btn-lg">
              {loggedIn ? 'Перейти в кабинет' : 'Начать бесплатно'}
            </Link>
            {!loggedIn && (
              <Link href="/login" className="btn btn-glass btn-lg">
                Войти
              </Link>
            )}
          </div>
        </div>
        <div data-reveal style={{ '--d': '120ms' } as React.CSSProperties} className="relative">
          <LeadForm />
        </div>
      </div>
    </section>
  );
}
