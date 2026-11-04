import { shareUrl } from './share';

export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const fail = (message: string, status = 400) => Response.json({ error: message }, { status });

/**
 * Тело запроса в JSON. Запросы без заголовка application/json не принимаем:
 * так чужой сайт не сможет отправить форму от имени пользователя (защита от CSRF).
 */
/**
 * Читает тело запроса, но не больше max байт. null — если прислали больше:
 * без этого один запрос на гигабайт (без Content-Length) мог съесть всю память сервера.
 */
export async function readBody(req: Request, max: number): Promise<Buffer | null> {
  if (Number(req.headers.get('content-length') || 0) > max) return null;
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks);
}

/** JSON из тела запроса (не больше max байт); при любой ошибке — пустой объект. */
export async function body<T>(req: Request, max = 1_000_000): Promise<Partial<T>> {
  // Строго application/json: «простой» запрос с чужой страницы (text/plain; charset=application/json) не пройдёт
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return {};
  try {
    const raw = await readBody(req, max);
    if (!raw) return {};
    // Символ \u0000 база данных не принимает (запрос падал с ошибкой 500) — убираем его из всех строк
    const data = JSON.parse(raw.toString('utf8'), (_k, v) => (typeof v === 'string' && v.includes('\u0000') ? v.replaceAll('\u0000', '') : v));
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Partial<T>) : {};
  } catch {
    return {};
  }
}

export const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.replaceAll('\u0000', '').trim().slice(0, max) : '');

/** Мягкое ограничение частоты запросов в памяти процесса (защита от перебора паролей и перерасхода ИИ). */
const hits = new Map<string, number[]>();
let calls = 0;
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  // Время от времени выбрасываем старые записи, чтобы память не росла
  if (++calls % 500 === 0) for (const [k, list] of hits) if (!list.length || now - list[list.length - 1] > 864e5) hits.delete(k);
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  return true;
}

/** Превышен ли лимит — без учёта текущего запроса (для счётчиков только неудачных попыток). */
export function limited(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length >= limit;
}

/** Сколько секунд осталось до снятия ограничения (для сообщения «подождите N секунд»). */
export function retryAfter(key: string, windowMs: number) {
  const list = hits.get(key);
  if (!list?.length) return 0;
  return Math.max(1, Math.ceil((list[0] + windowMs - Date.now()) / 1000));
}

/**
 * IP посетителя. Берём последний адрес из X-Forwarded-For: его дописывает ближайший прокси
 * (Caddy, Cloudflare), а первые адреса посетитель может подделать.
 */
export const clientIp = (req: Request) => {
  const xff = req.headers.get('x-forwarded-for');
  const last = xff?.split(',').map((s) => s.trim()).filter(Boolean).pop();
  return (last || req.headers.get('x-real-ip') || 'local').replace(/^::ffff:/, '');
};

const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/;

/**
 * Адрес сайта для ссылок в письмах: домен из DOMAIN (сервер с Docker) или адрес, с которого открыт сайт.
 * Если сайт открыт как localhost, а в окне share-windows.bat открыта ссылка для друга, — она: по localhost друг не попадёт.
 */
export function siteUrl(req: Request) {
  const domain = (process.env.DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (domain) return `https://${domain}`;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  if (LOCAL_HOST.test(host)) {
    const shared = shareUrl();
    if (shared) return shared;
  }
  const proto = (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  const url = `${proto || (LOCAL_HOST.test(host) ? 'http' : 'https')}://${host}`;
  (globalThis as { __partaOrigin?: string }).__partaOrigin = url;
  return url;
}

/** Адрес сайта для писем без запроса (фоновые задачи): домен, последний адрес, с которого открывали сайт, или localhost. */
export function baseUrl() {
  const domain = (process.env.DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (domain) return `https://${domain}`;
  return shareUrl() || (globalThis as { __partaOrigin?: string }).__partaOrigin || `http://localhost:${process.env.PORT || 3000}`;
}
