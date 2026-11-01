'use client';

import { useEffect, useState } from 'react';

/**
 * true, когда скрипты страницы загрузились и кнопки «ожили».
 * До этого кнопки отправки форм выключены: иначе браузер отправит форму сам —
 * и пароль окажется в адресной строке.
 */
export function useHydrated() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

/** Подсказка, если страница долго загружается (медленная сеть): видна через 4 секунды. */
export function WaitHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="wait-hint text-center text-[14px] text-ink-3">Страница ещё загружается… Если кнопка долго не нажимается — обновите страницу.</p>;
}
