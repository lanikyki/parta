'use client';

import { ChevronDown, CreditCard, Gift, LayoutDashboard, LifeBuoy, LogOut, Settings, Shield, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { UserAvatar } from './UserAvatar';

export type MenuUser = {
  name: string;
  email: string;
  avatar: string | null;
  tutor: boolean;
  admin: boolean;
  /** Подпись под именем: «Репетитор», «Ученик · 7 класс» */
  role: string;
  /** Тариф репетитора: название и до какого числа */
  plan: { id: 'free' | 'start' | 'pro'; name: string; until: string | null } | null;
};

const BADGE = { free: 'bg-mist text-ink-2', start: 'bg-tint text-brand-800', pro: 'bg-brand text-white' } as const;

export function PlanBadge({ plan }: { plan: NonNullable<MenuUser['plan']> }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[12px] leading-none font-medium ${BADGE[plan.id]}`}>
      {plan.id === 'free' ? 'Бесплатный' : `«${plan.name}»`}
    </span>
  );
}

/** Фото в шапке — открывает меню аккаунта. */
export function UserMenu({ user }: { user: MenuUser }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items: [string, string, typeof UserRound][] = [
    ['/dashboard', 'Кабинет', LayoutDashboard],
    ['/profile', 'Профиль', UserRound],
    ...(user.tutor
      ? ([
          ['/billing', 'Подписка и баланс', CreditCard],
          ['/referral', 'Реферальная программа', Gift],
        ] as [string, string, typeof UserRound][])
      : []),
    ['/settings', 'Настройки', Settings],
    ['/help', 'Помощь и поддержка', LifeBuoy],
    ...(user.admin ? ([['/admin', 'Админка', Shield]] as [string, string, typeof UserRound][]) : []),
  ];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Меню аккаунта"
        className="flex items-center gap-2.5 rounded-full p-1 pr-1 transition-colors hover:bg-mist md:pr-2.5"
      >
        <UserAvatar name={user.name} src={user.avatar} size={36} />
        <span className="hidden max-w-[180px] text-left text-[14px] leading-tight md:block">
          <b className="block truncate font-medium">{user.name}</b>
          <span className="block truncate text-ink-3">{user.plan ? (user.plan.id === 'free' ? 'Бесплатный тариф' : `Тариф «${user.plan.name}»`) : user.role}</span>
        </span>
        <ChevronDown size={16} className={`hidden text-ink-3 transition-transform md:block ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="pop-in absolute top-[calc(100%+8px)] right-0 z-50 w-[min(300px,calc(100vw-24px))] overflow-hidden rounded-[18px] border border-line bg-white shadow-lift"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-4">
            <UserAvatar name={user.name} src={user.avatar} size={48} />
            <span className="min-w-0 flex-1">
              <b className="block truncate font-medium">{user.name}</b>
              <span className="block truncate text-[13px] text-ink-3">{user.email}</span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {user.plan ? (
                  <>
                    <PlanBadge plan={user.plan} />
                    {user.plan.until && <span className="text-[12px] text-ink-3">до {user.plan.until}</span>}
                  </>
                ) : (
                  <span className="inline-flex h-6 items-center rounded-full bg-mist px-2.5 text-[12px] leading-none font-medium text-ink-2">{user.role}</span>
                )}
              </span>
            </span>
          </div>
          <nav className="grid p-1.5">
            {items.map(([href, label, Icon]) => (
              <Link
                key={href}
                href={href}
                role="menuitem"
                className={`flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors hover:bg-mist ${path === href ? 'font-medium text-brand-800' : 'text-ink'}`}
              >
                <Icon size={18} className={path === href ? 'text-brand-700' : 'text-ink-3'} />
                {label}
              </Link>
            ))}
            <form action="/api/auth/logout" method="post" className="mt-1 border-t border-line pt-1">
              <button type="submit" role="menuitem" className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-ink transition-colors hover:bg-mist">
                <LogOut size={18} className="text-ink-3" /> Выйти
              </button>
            </form>
          </nav>
        </div>
      )}
    </div>
  );
}
