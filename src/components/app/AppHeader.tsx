import { LogOut, Shield } from 'lucide-react';
import Link from 'next/link';
import { Logo, LogoMark } from '@/components/Logo';
import { isAdmin } from '@/lib/admin';
import type { User } from '@/lib/auth';
import { gradeLabel } from '@/lib/brand';
import { unreadTotal } from '@/lib/messages';
import { MessagesLink } from './MessagesLink';

export async function AppHeader({ user, active }: { user: User; active?: 'dashboard' | 'assistant' | 'messages' | 'admin' }) {
  const unread = await unreadTotal(user).catch(() => 0);
  const link = (href: string, label: React.ReactNode, key: string, aria?: string) => (
    <Link
      href={href}
      aria-label={aria}
      className={`rounded-[10px] px-2 py-2 text-[14px] whitespace-nowrap transition-colors sm:px-3 sm:text-[15px] ${active === key ? 'bg-tint font-medium text-brand-800' : 'text-ink-2 hover:text-ink'}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur-md">
      <div className="wrap flex h-16 items-center gap-2 sm:gap-6">
        <Link href="/" aria-label="На главную" className="shrink-0">
          <LogoMark className="h-8 w-8 sm:hidden" />
          <span className="hidden sm:block">
            <Logo />
          </span>
        </Link>
        <nav className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          {link('/dashboard', 'Кабинет', 'dashboard')}
          {link('/assistant', 'ИИ-помощник', 'assistant')}
          <MessagesLink initial={unread} active={active === 'messages'} />
          {isAdmin(user) &&
            link(
              '/admin',
              <>
                <Shield size={19} className="sm:hidden" />
                <span className="max-sm:sr-only">Админка</span>
              </>,
              'admin',
              'Админка',
            )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-right text-[14px] leading-tight md:block">
            <b className="block font-medium">{user.name}</b>
            <span className="text-ink-3">{user.role === 'tutor' ? 'Репетитор' : user.grade ? gradeLabel(user.grade) : 'Ученик'}</span>
          </span>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="grid h-10 w-10 place-items-center rounded-[10px] text-ink-2 hover:bg-mist hover:text-ink" aria-label="Выйти" title="Выйти">
              <LogOut size={19} />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
