// Общие мелочи для скриптов запуска (dev-all.mjs и share.mjs).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const isWin = process.platform === 'win32';
export const say = (s = '') => console.log(s);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Время для сообщений в окне: 14:05 */
export const clock = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Отвечает ли адрес (любой ответ, кроме ошибки сервера 5xx). */
export async function isUp(url, ms = 2000, headers = {}) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
    await r.body?.cancel().catch(() => {});
    return r.status < 500;
  } catch {
    return false;
  }
}

export async function waitUp(url, ms, headers = {}) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await isUp(url, Math.min(10000, Math.max(2000, end - Date.now())), headers)) return true;
    await sleep(1000);
  }
  return false;
}

export function openBrowser(url) {
  const [cmd, args] = isWin ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: isWin }).on('error', () => {}).unref();
  } catch {}
}

/** Распаковывает .zip или .tar.gz в папку. */
export function unpack(archive, dir) {
  if (!isWin) return spawnSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' }).status === 0;
  // В Windows 10/11 есть встроенный tar, который умеет zip; запасной вариант — PowerShell
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  if (fs.existsSync(tar) && spawnSync(tar, ['-xf', archive, '-C', dir], { stdio: 'inherit' }).status === 0) return true;
  const ps = `Expand-Archive -Force -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}'`;
  return spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' }).status === 0;
}

/** Путь к программе, если она установлена в системе (есть в PATH). */
export function which(name) {
  const r = spawnSync(isWin ? 'where' : 'which', [name], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 && r.stdout.trim() ? r.stdout.split(/\r?\n/)[0].trim() : '';
}

/** Скачивает файл целиком. */
export async function download(url, file, ms = 600000) {
  const res = await fetch(url, { headers: { 'user-agent': 'parta' }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`ошибка загрузки ${res.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** Кладёт текст в буфер обмена (Windows и macOS). */
export function copyText(text) {
  const cmd = isWin ? 'clip' : process.platform === 'darwin' ? 'pbcopy' : '';
  if (!cmd) return false;
  try {
    return spawnSync(cmd, [], { input: text, windowsHide: true, timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
}
