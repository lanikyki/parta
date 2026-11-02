// Файлы в сообщениях: общие для сервера и браузера типы и мелкие функции (без обращения к базе).

/** Файл, прикреплённый к сообщению. w и h — размер картинки в точках (для фото). */
export type MsgFile = { id: string; name: string; mime: string; size: number; w?: number; h?: number };

/** Не больше 10 МБ на файл и 10 файлов в одном сообщении. */
export const MAX_FILE = 10_000_000;
export const MAX_FILES = 10;

/** Картинки, которые показываем прямо в переписке. Остальное (PDF, документы, SVG…) — только скачать. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const isImage = (f: Pick<MsgFile, 'mime'>) => IMAGE_TYPES.includes(f.mime);

export const fileUrl = (f: Pick<MsgFile, 'id'>, download = false) => `/api/messages/files/${f.id}${download ? '?download=1' : ''}`;

/** 1,2 МБ / 350 КБ */
export function fmtSize(n: number) {
  if (n < 1000) return `${n} Б`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} КБ`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace('.', ',')} МБ`;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

/** Короткая подпись для списка переписок и писем: «📷 Фото», «📎 задание.pdf», «📎 3 файла». */
export function filesSummary(files: Pick<MsgFile, 'name' | 'mime'>[] | null | undefined) {
  if (!files?.length) return '';
  const images = files.filter(isImage).length;
  if (images === files.length) return images === 1 ? '📷 Фото' : `📷 ${images} фото`;
  if (files.length === 1) return `📎 ${files[0].name}`;
  return `📎 ${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')}`;
}

/** Превью сообщения в списке переписок: текст, а если есть вложения — со значком 📷 или 📎. */
export function msgPreview(text: string, files: Pick<MsgFile, 'name' | 'mime'>[] | null | undefined) {
  if (!files?.length) return text;
  if (!text) return filesSummary(files);
  return `${files.every(isImage) ? '📷' : '📎'} ${text}`;
}
