import { useEffect } from 'react';

/*
 * Адрес сайта для ссылок, которые отправляют другим людям («Скопировать ссылку» и т. п.).
 * Если сайт открыт как localhost или по адресу в домашней сети, а в окне share-windows.bat открыта
 * ссылка для друга, — подставляем её: по localhost друг на сайт не попадёт.
 */
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])$/;
let cached: { at: number; origin: string } | null = null;
let pending: Promise<string> | null = null;

function refresh() {
  if (pending || (cached && Date.now() - cached.at < 5000)) return;
  pending = fetch('/api/health', { cache: 'no-store' })
    .then((r) => r.json())
    .then((h: { publicUrl?: unknown }) => (typeof h?.publicUrl === 'string' && /^https:\/\//.test(h.publicUrl) ? h.publicUrl : location.origin))
    .catch(() => location.origin)
    .then((origin) => {
      cached = { at: Date.now(), origin };
      pending = null;
      return origin;
    });
}

/** Адрес для ссылок прямо сейчас (в обработчике клика — без ожидания). */
export function shareOrigin() {
  return (LOCAL.test(location.hostname) && cached?.origin) || location.origin;
}

/** Заранее узнаёт адрес ссылки для друга (и обновляет, когда вкладка снова в фокусе). */
export function usePublicOrigin() {
  useEffect(() => {
    if (!LOCAL.test(location.hostname)) return;
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
}
