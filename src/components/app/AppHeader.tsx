import { Shield } from 'lucide-react';
import Link from 'next/link';
import { Logo, LogoMark } from '@/components/Logo';
import { isAdmin } from '@/lib/admin';
import type { User } from '@/lib/auth';
import { avatarUrl } from '@/lib/avatar';
import { subscription } from '@/lib/billing';
import { gradeLabel } from '@/lib/brand';
import { unreadTotal } from '@/lib/messages';
import { PLANS, shortDate } from '@/lib/plans';
import { MessagesLink } from './MessagesLink';
import { type MenuUser, UserMenu } from './UserMenu';

export type HeaderTab = 'dashboard' | 'assistant' | 'messages' | 'admin';

export async function AppHeader({ user, active }: { user: User; active?: HeaderTab }) {
  const tutor = user.role === 'tutor';
  const [unread, sub] = await Promise.all([unreadTotal(user).catch(() => 0), tutor ? subscription(user.id).catch(() => null) : null]);
  const menu: MenuUser = {
    name: user.name,
    email: user.email,
    avatar: user.avatar_at ? avatarUrl(user.id, user.avatar_at) : null,
    tutor,
    admin: isAdmin(user),
    role: tutor ? 'Репетитор' : user.grade ? `Ученик · ${gradeLabel(user.grade).toLowerCase()}` : 'Ученик',
    plan: tutor ? (sub?.plan ? { id: sub.plan, name: PLANS[sub.plan].name, until: sub.until ? shortDate(sub.until) : null } : { id: 'free', name: 'Бесплатный', until: null }) : null,
  };
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
          {menu.admin &&
            link(
              '/admin',
              <>
                <Shield size={19} className="lg:hidden" />
                <span className="max-lg:sr-only">Админка</span>
              </>,
              'admin',
              'Админка',
            )}
        </nav>
        <div className="ml-auto flex items-center">
          <UserMenu user={menu} />
        </div>
      </div>
    </header>
  );
}
