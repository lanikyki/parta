'use client';

import { useEffect, useState } from 'react';

/** Сколько секунд прошло с начала ожидания — для подписей вроде «Думаю… 12 с». */
export function useElapsed(active: boolean) {
  const [since, setSince] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t0 = Date.now();
    setSince(t0);
    setNow(t0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return active && since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}

/** «45 с» или «1 мин 05 с». */
export const formatSec = (s: number) => (s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, '0')} с`);
