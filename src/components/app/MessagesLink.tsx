'use client';

import { MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/** Событие от страницы «Сообщения»: число непрочитанных изменилось. */
export const UNREAD_EVENT = 'parta:unread';

/** Ссылка «Сообщения» в шапке со счётчиком непрочитанных (обновляется раз в 30 секунд). */
export function MessagesLink({ initial, active }: { initial: number; active: boolean }) {
  const [count, setCount] = useState(initial);

  useEffect(() => {
    const onEvent = (e: Event) => setCount((e as CustomEvent<number>).detail);
    window.addEventListener(UNREAD_EVENT, onEvent);
    if (active) return () => window.removeEventListener(UNREAD_EVENT, onEvent);
    const load = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/messages/unread', { cache: 'no-store' });
        if (res.ok) setCount((await res.json()).count ?? 0);
      } catch {}
    };
    const id = setInterval(load, 30_000);
    const onShow = () => !document.hidden && load();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener(UNREAD_EVENT, onEvent);
    };
  }, [active]);

  return (
    <Link
      href="/messages"
      aria-label={count ? `Сообщения, непрочитанных: ${count}` : 'Сообщения'}
      className={`relative inline-flex items-center gap-1.5 rounded-[10px] px-2 py-2 text-[14px] whitespace-nowrap transition-colors sm:px-3 sm:text-[15px] ${active ? 'bg-tint font-medium text-brand-800' : 'text-ink-2 hover:text-ink'}`}
    >
      <MessageCircle size={19} className="sm:hidden" />
      <span className="max-sm:sr-only">Сообщения</span>
      {count > 0 && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[12px] leading-none font-medium text-white max-sm:absolute max-sm:-top-0.5 max-sm:-right-1">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
