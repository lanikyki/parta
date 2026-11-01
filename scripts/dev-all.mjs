// Запуск всего сразу: видеосервер LiveKit + сайт + проверка настроек.
// Запуск: npm run dev:all (в Windows можно просто дважды щёлкнуть start-windows.bat)
// Показать сайт другу через интернет: npm run share (в Windows — share-windows.bat)
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, addNewSettings, readEnv } from './check.mjs';
import { startShare } from './share.mjs';
import { download, isUp, isWin, openBrowser, say, unpack, waitUp, which } from './util.mjs';

process.chdir(ROOT);
const TOOLS = path.join(ROOT, 'tools');
const SITE = 'http://localhost:3000';
const SHARE = process.argv.includes('--share');

async function findLiveKit() {
  const exe = isWin ? 'livekit-server.exe' : 'livekit-server';
  const local = path.join(TOOLS, exe);
  if (fs.existsSync(local)) return local;
  const found = which('livekit-server');
  if (found) return found;
  if (process.platform === 'darwin') {
    say('Для видео установите LiveKit командой: brew install livekit — и запустите снова.');
    return null;
  }
  const arch = { x64: 'amd64', arm64: 'arm64', arm: 'armv7' }[process.arch];
  const os = isWin ? 'windows' : 'linux';
  const manual = `Скачайте вручную: https://github.com/livekit/livekit/releases/latest → файл livekit_..._${os}_${arch || 'amd64'} — и положите ${exe} в папку tools проекта.`;
  if (!arch) {
    say(`Не знаю, какой LiveKit нужен для этого компьютера. ${manual}`);
    return null;
  }
  say('Скачиваю видеосервер LiveKit (один раз, около 20 МБ)…');
  try {
    const rel = await (await fetch('https://api.github.com/repos/livekit/livekit/releases/latest', { headers: { 'user-agent': 'parta' }, signal: AbortSignal.timeout(20000) })).json();
    const asset = rel.assets?.find((a) => a.name.includes(`_${os}_${arch}.`));
    if (!asset) throw new Error('на GitHub нет файла для этой системы');
    const archive = path.join(TOOLS, asset.name);
    await download(asset.browser_download_url, archive);
    const ok = unpack(archive, TOOLS);
    fs.rmSync(archive, { force: true });
    if (!ok || !fs.existsSync(local)) throw new Error('не удалось распаковать архив');
    if (!isWin) fs.chmodSync(local, 0o755);
    say(`Готово: ${path.relative(ROOT, local)}`);
    return local;
  } catch (e) {
    say(`Не получилось скачать LiveKit (${e.message}). ${manual}`);
    return null;
  }
}

/** Каких библиотек не хватает (или стоят старые версии) — например, после обновления проекта. */
function missingDeps() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter(([name, want]) => {
      try {
        const have = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
        return /^\d/.test(want) && have !== want; // версии в package.json записаны точно
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
}

/* ───────── Показ сайта другу через интернет ───────── */

// «Отпечаток» исходников: если он изменился (например, после обновления), сайт нужно собрать заново
function sourceSignature() {
  const h = crypto.createHash('sha1');
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p).sort()) walk(path.join(p, f));
    else h.update(`${path.relative(ROOT, p)}:${st.size}:${Math.round(st.mtimeMs)}\n`);
  };
  for (const p of ['src', 'public', 'package.json', 'package-lock.json', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json'])
    if (fs.existsSync(path.join(ROOT, p))) walk(path.join(ROOT, p));
  return h.digest('hex');
}
const BUILD_SIG = path.join(ROOT, '.next', 'parta-build.txt');

async function share(env, children, stop) {
  if (await isUp(SITE)) {
    // Режим «для себя» (start-windows, npm run dev) по ссылке не показываем: он медленный,
    // а друг увидел бы служебные подсказки. Для показа нужен свой запуск — собранный сайт.
    const h = await fetch(`${SITE}/api/health`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .catch(() => null);
    if (h?.dev !== false) {
      say(`\nНа ${SITE} уже работает сайт из другого окна (start-windows.bat или npm run dev).`);
      say('Это режим «для себя»: показывать его по ссылке нельзя — он медленный и может «лечь».');
      say('Закройте то окно (или нажмите в нём Ctrl+C) и запустите share-windows.bat ещё раз.');
      stop();
      process.exit(1);
    }
    // Ссылка уже открыта из другого окна — вторая не нужна (а у Tuna на бесплатном тарифе её и не дадут)
    const urlFile = path.join(TOOLS, 'share-url.txt');
    const fresh = fs.existsSync(urlFile) && Date.now() - fs.statSync(urlFile).mtimeMs < 120000;
    const open = fresh ? fs.readFileSync(urlFile, 'utf8').trim() : '';
    if (open) {
      say(`\nСсылка для друга уже открыта в другом окне: ${open}`);
      say('Это окно можно закрыть.');
      stop();
      process.exit(0);
    }
    say('\nСайт уже запущен в другом окне — открою доступ к нему.');
  } else {
    const sig = sourceSignature();
    const built = fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')) && fs.existsSync(BUILD_SIG) && fs.readFileSync(BUILD_SIG, 'utf8') === sig;
    if (!built) {
      say('\nСобираю сайт для показа (1–3 минуты; заново — только после обновлений)…\n');
      if (spawnSync('npm run build', { stdio: 'inherit', shell: true }).status !== 0) {
        say('\nСборка не удалась — посмотрите сообщения выше.');
        stop();
        process.exit(1);
      }
      fs.writeFileSync(BUILD_SIG, sig);
    }
    say('\nЗапускаю сайт…\n');
    const site = spawn('npm run start', { stdio: 'inherit', shell: true });
    children.push(site);
    site.on('exit', (code) => {
      stop();
      process.exit(code ?? 0);
    });
    if (!(await waitUp(`${SITE}/api/health`, 120000))) {
      say('Сайт не запустился — посмотрите сообщения выше.');
      stop();
      process.exit(1);
    }
  }
  const { runChecks } = await import('./check.mjs');
  say('\nПроверка настроек:');
  await runChecks({ brief: true, autofill: true });

  // Ссылка для друга: сервисы по очереди, проверка ссылки и присмотр за ней — в share.mjs
  await startShare({ env, children });
}

/** Копии проекта внутри папки проекта (например, после распаковки архива «внутрь») ломают сборку. */
function strayCopies() {
  const skip = new Set(['node_modules', '.next', '.git', 'src', 'public', 'scripts', 'deploy', 'tools', 'data']);
  const found = [];
  const look = (dir, depth) => {
    let items = [];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of items) {
      if (!d.isDirectory() || (depth === 0 && skip.has(d.name)) || d.name === 'node_modules') continue;
      const sub = path.join(dir, d.name);
      if (fs.existsSync(path.join(sub, 'package.json')) && fs.existsSync(path.join(sub, 'scripts', 'dev-all.mjs'))) found.push(path.relative(ROOT, sub));
      else if (depth < 1) look(sub, depth + 1);
    }
  };
  look(ROOT, 0);
  return found;
}

/** SHARE_VIA из прошлых версий больше не нужен: сервис для ссылки теперь выбирается сам (SHARE_SERVICE). */
function retireShareVia(file) {
  const text = fs.readFileSync(file, 'utf8');
  const next = text.replace(/^([ \t]*SHARE_VIA[ \t]*=[^\r\n]*)/m, '# $1   ← устарело: теперь сервис выбирается сам (см. SHARE_SERVICE)');
  if (next !== text) fs.writeFileSync(file, next);
}

async function main() {
  say(SHARE ? '\nПарта: запускаю сайт и открываю доступ другу\n' : '\nПарта: запускаю сайт\n');
  if (Number(process.versions.node.split('.')[0]) < 20) {
    say(`Нужен Node.js 22 или новее, а у вас ${process.version}. Скачайте версию LTS с https://nodejs.org и запустите снова.`);
    process.exit(1);
  }

  const copies = strayCopies();
  if (copies.length) {
    say(`Внимание: внутри папки проекта лежит ещё одна копия «Парты»: ${copies.join(', ')}.`);
    say('Перенесите её в другое место (например, на рабочий стол) или удалите — иначе сайт может не собраться.\n');
  }

  // 1. Библиотеки (и новые — после обновления проекта)
  const missing = missingDeps();
  if (missing.length) {
    const fresh = !fs.existsSync(path.join(ROOT, 'node_modules', 'next'));
    say(fresh ? 'Устанавливаю библиотеки (один раз, 1–3 минуты)…\n' : `Доустанавливаю библиотеки после обновления (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''})…\n`);
    const r = spawnSync('npm install', { stdio: 'inherit', shell: true });
    if (r.status !== 0) {
      say('\nНе получилось установить библиотеки — посмотрите сообщения выше.');
      process.exit(1);
    }
  }

  // 2. Файл настроек
  const envFile = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envFile)) {
    fs.copyFileSync(path.join(ROOT, '.env.example'), envFile);
    say('Создал файл настроек .env.local — в нём можно включить ИИ-помощника (см. README).');
  } else {
    retireShareVia(envFile);
    const added = addNewSettings(envFile);
    if (added.length) say(`Дописал в .env.local новые настройки: ${added.join(', ')}. Что в них вписать — в пояснениях в самом файле и в README.`);
  }
  const env = readEnv(envFile) || {};

  // 3. Видеосервер (если в настройках указан локальный)
  const children = [];
  const lkUrl = env.LIVEKIT_URL || '';
  if (/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(lkUrl) && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) {
    const lkHttp = lkUrl.replace(/^ws/, 'http');
    if (await isUp(lkHttp)) say('Видеосервер уже запущен.');
    else {
      const bin = await findLiveKit();
      if (bin) {
        fs.mkdirSync(TOOLS, { recursive: true });
        const logFd = fs.openSync(path.join(TOOLS, 'livekit.log'), 'a');
        const keys = `${env.LIVEKIT_API_KEY}: ${env.LIVEKIT_API_SECRET}`;
        const args = env.LIVEKIT_API_KEY === 'devkey' && env.LIVEKIT_API_SECRET === 'secret' ? ['--dev'] : ['--dev', '--keys', keys];
        const lk = spawn(bin, args, { stdio: ['ignore', logFd, logFd], windowsHide: true });
        lk.on('error', (e) => say(`Видеосервер не запустился: ${e.message}`));
        children.push(lk);
        say((await waitUp(lkHttp, 20000)) ? 'Видеосервер запущен.' : 'Видеосервер не ответил — подробности в tools/livekit.log. Урок откроется без видео.');
      }
    }
  }

  // Ctrl+C или закрытие окна — останавливаем всё, что запустили
  const stop = () => {
    for (const c of children) {
      try {
        c.kill();
      } catch {}
    }
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      stop();
      process.exit(0);
    });
  }

  // 4. Сайт
  if (SHARE) return share(env, children, stop);
  if (await isUp(SITE)) {
    say(`\nСайт уже запущен в другом окне: ${SITE}`);
    if (children.length) say('Видеосервер работает, пока открыто это окно.');
    openBrowser(SITE);
    return;
  }
  say('Запускаю сайт…\n');
  const site = spawn('npm run dev', { stdio: 'inherit', shell: true });
  children.push(site);
  site.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });

  // 5. Когда сайт ответит — открываем браузер и проверяем настройки
  if (await waitUp(`${SITE}/api/health`, 180000)) {
    openBrowser(SITE);
    const { runChecks } = await import('./check.mjs');
    say('\nПроверка настроек:');
    await runChecks({ brief: true, autofill: true });
    say(`\nСайт работает: ${SITE}   Остановить — Ctrl+C в этом окне.\n`);
  }
}

main();
