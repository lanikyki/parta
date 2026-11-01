'use client';

import { useEffect } from 'react';

/** Плавно показывает блоки с атрибутом data-reveal, когда они попадают в экран. */
export function Reveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)'));
    // Пока скрипт не загрузился, CSS сам проявит блоки через 2,5 с (см. reveal-late в globals.css).
    // Если загрузка шла дольше и блоки уже видны — просто фиксируем это без повторной анимации.
    const root = document.documentElement;
    const late = !root.classList.contains('reveal-on') && els.some((el) => getComputedStyle(el).opacity !== '0');
    root.classList.add('reveal-on');
    if (late || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
