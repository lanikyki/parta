/**
 * Адрес «куда вернуться после входа» (?next=…). Пускаем только пути внутри сайта:
 * «/\evil.com» и «/<Tab>/evil.com» браузер превращает в «//evil.com» — это увело бы человека на чужой сайт.
 */
export function safeNext(next: unknown): string | null {
  if (typeof next !== 'string' || next.length > 500) return null;
  if (!/^\/(?![/\\])/.test(next) || /[\\\u0000-\u001f\u007f]/.test(next)) return null;
  return next;
}

/** Параметры адреса: «?q=a&q=b» приходит массивом — берём первое значение, чтобы страница не падала. */
export async function firstParams(sp: Promise<Record<string, string | string[] | undefined>>): Promise<Record<string, string | undefined>> {
  return Object.fromEntries(Object.entries(await sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}
