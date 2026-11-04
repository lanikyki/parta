import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { MobileMenu } from './MobileMenu';

export const NAV = [
  { href: '/#how', label: 'Возможности' },
  { href: '/#for', label: 'Для кого' },
  { href: '/#start', label: 'Как начать' },
  { href: '/#subjects', label: 'Предметы' },
  { href: '/#pricing', label: 'Тарифы' },
  { href: '/#faq', label: 'Вопросы' },
];

export function Header({ loggedIn }: { loggedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md">
      <div className="wrap flex h-[72px] items-center gap-4 sm:gap-8">
        <Link href="/" aria-label="На главную" className="shrink-0">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-4 text-[15px] whitespace-nowrap text-ink-2 lg:flex xl:gap-7">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="transition-colors hover:text-brand-700">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {loggedIn ? (
            <Link href="/dashboard" className="btn btn-primary btn-sm max-sm:px-3">
              Кабинет
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-line btn-sm hidden sm:inline-flex">
                Войти
              </Link>
              <Link href="/register?role=tutor" className="btn btn-primary btn-sm max-sm:px-3 max-[359px]:hidden">
                Начать бесплатно
              </Link>
            </>
          )}
          <MobileMenu loggedIn={loggedIn} items={NAV} />
        </div>
      </div>
    </header>
  );
}
