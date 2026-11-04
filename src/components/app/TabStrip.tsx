'use client';

import { useEffect, useRef } from 'react';

/** Лента разделов: на телефоне она прокручивается вбок — сразу показываем открытый раздел. */
export function TabStrip({ label, className, children }: { label: string; className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const shift = active.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollLeft += shift;
  }, []);
  return (
    <nav ref={ref} aria-label={label} className={className}>
      {children}
    </nav>
  );
}
