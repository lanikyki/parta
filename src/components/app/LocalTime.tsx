'use client';

import { useEffect, useState } from 'react';

/** Показывает дату во времени пользователя (на сервере часовой пояс может отличаться). */
export function LocalTime({ iso, withTime = true, compact = false }: { iso: string; withTime?: boolean; compact?: boolean }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const d = new Date(iso);
    const opts: Intl.DateTimeFormatOptions = compact ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'long' };
    if (compact && d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    setText(d.toLocaleString('ru-RU', opts));
  }, [iso, withTime, compact]);
  return <time dateTime={iso}>{text || '\u00a0'}</time>;
}
