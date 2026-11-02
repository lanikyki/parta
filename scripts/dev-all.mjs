// Запуск всего сразу: видеосервер LiveKit + сайт + проверка настроек.
// Запуск: npm run dev:all (в Windows можно просто дважды щёлкнуть start-windows.bat)
// Показать сайт другу через интернет: npm run share (в Windows — share-windows.bat)
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ROOT, addNewSettings, readEnv } from './check.mjs';
import { startGateway } from './gateway.mjs';
import { startShare } from './share.mjs';
import { isUp, openBrowser, say, sleep, waitUp } from './util.mjs';
import { findLiveKit, startShareVideo } from './video.mjs';

process.chdir(ROOT);
const TOOLS = path.join(ROOT, 'tools');
const SITE = 'http://localhost:3000';
const SHARE = process.argv.includes('--share');

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

/** Свободный порт для сайта «за дверью» (обычно 3001). */
function freePort(from) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const srv = net.createServer();
      srv.once('error', () => tryPort(port + 1));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(port)));
    };
    tryPort(from);
  });
}

/** Сообщения сайта — в окно, кроме адресов «Local/Network»: сайт открывают по адресу «двери» (3000) или по ссылке. */
function relay(stream, out) {
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? '';
    for (const l of lines) if (!/^\s*-\s*(Local|Network):/.test(l)) out.write(`${l}\n`);
  });
  stream.on('end', () => rest && out.write(`${rest}\n`));
}

async function share(env, children, stop, cleanups) {
  let video = null;
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

    // Видео: свой видеосервер на этом компьютере (SHARE_VIDEO=cloud — как в .env.local, например LiveKit Cloud)
    if ((env.SHARE_VIDEO || '').trim().toLowerCase() !== 'cloud') {
      video = await startShareVideo({ journal: (s) => fs.appendFileSync(path.join(TOOLS, 'share.log'), `${new Date().toISOString()} ${s}\n`) });
      if (video) {
        children.push(video.proc);
        cleanups.push(video.close);
      } else if (env.LIVEKIT_URL && !/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.LIVEKIT_URL)) say(`Видео будет через ${env.LIVEKIT_URL} (из .env.local).`);
    }

    // Сайт работает «за дверью» на соседнем порту, а дверь на 3000 делит запросы между сайтом и видео
    const port = await freePort(3001);
    say('\nЗапускаю сайт…\n');
    const site = spawn(`npm run start -- -p ${port} -H 127.0.0.1`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, ...(video?.env || {}) },
    });
    relay(site.stdout, process.stdout);
    relay(site.stderr, process.stderr);
    children.push(site);
    site.on('exit', (code) => {
      stop();
      process.exit(code ?? 0);
    });
    const gate = startGateway({
      port: 3000,
      site: { host: '127.0.0.1', port },
      video: video?.signal,
      onError: (e) => {
        say(e.code === 'EADDRINUSE' ? '\nПорт 3000 занят другой программой — закройте её и запустите share-windows.bat снова.' : `\nНе удалось открыть сайт: ${e.message}`);
        stop();
        process.exit(1);
      },
    });
    cleanups.push(() => new Promise((r) => gate.close(() => r())));
    if (!(await waitUp(`${SITE}/api/health`, 120000))) {
      say('Сайт не запустился — посмотрите сообщения выше.');
      stop();
      process.exit(1);
    }
  }
  const { runChecks } = await import('./check.mjs');
  say('\nПроверка настроек:');
  await runChecks({ brief: true, autofill: true, skipVideo: Boolean(video) });

  // Ссылка для друга: сервисы по очереди, проверка ссылки и присмотр за ней — в share.mjs
  await startShare({ env, children, video: video ? 'local' : '' });
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

  // 3. Видеосервер (если в настройках указан локальный). Для показа другу — свой запуск, в share()
  const children = [];
  const cleanups = [];
  const lkUrl = env.LIVEKIT_URL || '';
  if (!SHARE && /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(lkUrl) && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) {
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
  let quitting = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, async () => {
      if (quitting) return;
      quitting = true;
      // Закрываем за собой порты на роутере (не дольше пары секунд)
      await Promise.race([Promise.allSettled(cleanups.map((f) => f())), sleep(2500)]);
      stop();
      process.exit(0);
    });
  }

  // 4. Сайт
  if (SHARE) return share(env, children, stop, cleanups);
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
