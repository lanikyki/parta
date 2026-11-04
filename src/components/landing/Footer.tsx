import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { BRAND } from '@/lib/brand';

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="wrap grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-[340px] text-[15px] leading-relaxed text-ink-2">{BRAND.description}</p>
        </div>
        <nav className="grid content-start gap-3 text-[15px]">
          <p className="tag text-ink-3">Сервис</p>
          <a href="/#how" className="hover:text-brand-700">Возможности</a>
          <a href="/#for" className="hover:text-brand-700">Для кого</a>
          <a href="/#start" className="hover:text-brand-700">Как начать</a>
          <a href="/#faq" className="hover:text-brand-700">Вопросы</a>
        </nav>
        <nav className="grid content-start gap-3 text-[15px]">
          <p className="tag text-ink-3">Аккаунт</p>
          <Link href="/register?role=tutor" className="hover:text-brand-700">Регистрация</Link>
          <Link href="/login" className="hover:text-brand-700">Вход в кабинет</Link>
          <Link href="/assistant" className="hover:text-brand-700">ИИ-помощник</Link>
          <a href="/#lead" className="hover:text-brand-700">Задать вопрос</a>
        </nav>
      </div>
      <div className="wrap">
        <div className="flex flex-wrap justify-between gap-2 border-t border-line py-6 text-[13px] text-ink-3">
          <span>
            © {new Date().getFullYear()} {BRAND.name}
          </span>
          <span>{BRAND.tagline}</span>
        </div>
      </div>
    </footer>
  );
}
