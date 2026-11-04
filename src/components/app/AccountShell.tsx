import { CreditCard, Gift, LifeBuoy, Settings, UserRound } from 'lucide-react';
import Link from 'next/link';
import type { User } from '@/lib/auth';
import { AppHeader } from './AppHeader';
import { TabStrip } from './TabStrip';

export type AccountTab = 'profile' | 'billing' | 'referral' | 'settings' | 'help';

/** Страницы аккаунта: шапка, слева (на телефоне — сверху) разделы, справа содержимое. */
export async function AccountShell({ user, active, title, lead, children }: { user: User; active: AccountTab; title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  const tutor = user.role === 'tutor';
  const tabs: [AccountTab, string, string, typeof UserRound][] = [
    ['profile', '/profile', 'Профиль', UserRound],
    ...(tutor
      ? ([
          ['billing', '/billing', 'Подписка и баланс', CreditCard],
          ['referral', '/referral', 'Реферальная программа', Gift],
        ] as [AccountTab, string, string, typeof UserRound][])
      : []),
    ['settings', '/settings', 'Настройки', Settings],
    ['help', '/help', 'Помощь и поддержка', LifeBuoy],
  ];
  return (
    <div className="min-h-dvh bg-mist/60">
      <AppHeader user={user} />
      <main className="wrap grid grid-cols-1 gap-6 py-6 sm:py-10 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <TabStrip label="Разделы аккаунта" className="-mx-5 flex gap-1 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:-mx-8 md:px-8 lg:sticky lg:top-24 lg:mx-0 lg:grid lg:content-start lg:self-start lg:overflow-visible lg:px-0">
          {tabs.map(([key, href, label, Icon]) => (
            <Link
              key={key}
              href={href}
              aria-current={active === key ? 'page' : undefined}
              className={`flex h-10 shrink-0 items-center gap-2.5 rounded-xl px-3.5 text-[15px] whitespace-nowrap transition-colors lg:h-11 ${
                active === key ? 'bg-white font-medium text-brand-800 shadow-soft' : 'text-ink-2 hover:bg-white/70 hover:text-ink'
              }`}
            >
              <Icon size={18} className={active === key ? 'text-brand-700' : 'text-ink-3'} />
              {label}
            </Link>
          ))}
        </TabStrip>
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-medium sm:text-[34px]">{title}</h1>
          {lead && <p className="mt-1.5 max-w-[640px] text-[16px] text-ink-2">{lead}</p>}
          <div className="mt-6 grid gap-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
