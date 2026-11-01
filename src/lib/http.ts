export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const fail = (message: string, status = 400) => Response.json({ error: message }, { status });

/**
 * Тело запроса в JSON. Запросы без заголовка application/json не принимаем:
 * так чужой сайт не сможет отправить форму от имени пользователя (защита от CSRF).
 */
export async function body<T>(req: Request): Promise<Partial<T>> {
  if (!(req.headers.get('content-type') || '').includes('application/json')) return {};
  try {
    const data = await req.json();
    return data && typeof data === 'object' ? (data as Partial<T>) : {};
  } catch {
    return {};
  }
}

export const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

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

/** Адрес сайта для ссылок в письмах: домен из DOMAIN (сервер с Docker) или адрес, с которого открыт сайт. */
export function siteUrl(req: Request) {
  const domain = (process.env.DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (domain) return `https://${domain}`;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  const proto = (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  return `${proto || (/^(localhost|127\.|192\.168\.|10\.)/.test(host) ? 'http' : 'https')}://${host}`;
}
