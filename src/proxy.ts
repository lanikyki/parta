import { NextResponse, type NextRequest } from 'next/server';
import { shareUrl } from '@/lib/share';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
// Ответ без тела: браузер всё равно не покажет его чужой странице
const deny = () => new NextResponse(null, { status: 403, headers: { 'x-parta-blocked': 'csrf' } });
const hostOf = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Защита от подделки запросов (CSRF). Браузер считает ссылки туннелей вроде *.ru.tuna.am «одним сайтом»
 * с чужими туннелями на том же домене, и страница злоумышленника на соседнем адресе могла бы отправлять
 * запросы от имени вошедшего пользователя (писать сообщения, создавать уроки, выходить из аккаунта).
 * Поэтому изменяющие запросы к API принимаем только со страниц самого сайта.
 */
export function proxy(req: NextRequest) {
  if (SAFE.has(req.method)) return;
  // Современные браузеры по https и на localhost прямо сообщают, откуда запрос
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none' ? undefined : deny();
  // Старые браузеры и обычный http (адрес в домашней сети): сверяем Origin с адресом сайта
  const origin = req.headers.get('origin');
  if (!origin || origin === 'null') return;
  const own = [req.headers.get('host'), req.headers.get('x-forwarded-host'), hostOf(shareUrl()), process.env.DOMAIN]
    .flatMap((h) => (h || '').split(','))
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
    .filter(Boolean);
  if (!own.includes(hostOf(origin))) return deny();
}

export const config = { matcher: '/api/:path*' };
