'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function MobileMenu({ loggedIn, items }: { loggedIn: boolean; items: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
        className="grid h-10 w-10 place-items-center rounded-[10px] text-ink hover:bg-tint"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-[72px] border-t border-line bg-white shadow-soft">
          <nav className="wrap grid py-3">
            {items.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-2 py-3 text-[17px] font-medium hover:bg-mist"
              >
                {n.label}
              </a>
            ))}
            {!loggedIn && (
              <div className="mt-2 mb-2 grid gap-2 sm:hidden">
                <Link href="/register?role=tutor" className="btn btn-primary min-[360px]:hidden">
                  Начать бесплатно
                </Link>
                <Link href="/login" className="btn btn-line">
                  Войти
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
