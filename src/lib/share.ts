import fs from 'node:fs';
import path from 'node:path';

/**
 * Ссылка для друга, открытая сейчас в окне share-windows.bat (пусто — не открыта).
 * Файл пишет scripts/share.mjs и обновляет каждые полминуты; старый файл (окно закрыли аварийно) не считаем.
 */
export function shareUrl(): string {
  try {
    const file = path.join(process.cwd(), 'tools', 'share-url.txt');
    if (Date.now() - fs.statSync(file).mtimeMs > 180000) return '';
    const url = fs.readFileSync(file, 'utf8').trim();
    return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url) ? url : '';
  } catch {
    return '';
  }
}
