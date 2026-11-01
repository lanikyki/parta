// Запуск всего сразу: видеосервер LiveKit + сайт + проверка настроек.
// Запуск: npm run dev:all (в Windows можно просто дважды щёлкнуть start-windows.bat)
// Показать сайт другу через интернет: npm run share (в Windows — share-windows.bat)
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, addNewSettings, readEnv } from './check.mjs';

process.chdir(ROOT);
const isWin = process.platform === 'win32';
const TOOLS = path.join(ROOT, 'tools');
const SITE = 'http://localhost:3000';
const SHARE = process.argv.includes('--share');
const say = (s = '') => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isUp(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.status < 500;
  } catch {
    return false;
  }
}

async function waitUp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await isUp(url)) return true;
    await sleep(1000);
  }
  return false;
}

function openBrowser(url) {
  const [cmd, args] = isWin ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: isWin }).on('error', () => {}).unref();
  } catch {}
}

function unpack(archive, dir) {
  if (!isWin) return spawnSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' }).status === 0;
  // В Windows 10/11 есть встроенный tar, который умеет zip; запасной вариант — PowerShell
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  if (fs.existsSync(tar) && spawnSync(tar, ['-xf', archive, '-C', dir], { stdio: 'inherit' }).status === 0) return true;
  const ps = `Expand-Archive -Force -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}'`;
  return spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' }).status === 0;
}

async function findLiveKit() {
  const exe = isWin ? 'livekit-server.exe' : 'livekit-server';
  const local = path.join(TOOLS, exe);
  if (fs.existsSync(local)) return local;
  const found = spawnSync(isWin ? 'where' : 'which', ['livekit-server'], { encoding: 'utf8' });
  if (found.status === 0 && found.stdout.trim()) return found.stdout.split(/\r?\n/)[0].trim();
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
    const res = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(600000) });
    if (!res.ok) throw new Error(`ошибка загрузки ${res.status}`);
    fs.mkdirSync(TOOLS, { recursive: true });
    const archive = path.join(TOOLS, asset.name);
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
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

async function findCloudflared() {
  const exe = isWin ? 'cloudflared.exe' : 'cloudflared';
  const local = path.join(TOOLS, exe);
  if (fs.existsSync(local)) return local;
  const found = spawnSync(isWin ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' });
  if (found.status === 0 && found.stdout.trim()) return found.stdout.split(/\r?\n/)[0].trim();
  const arch = { x64: 'amd64', arm64: 'arm64', ia32: '386', arm: 'arm' }[process.arch];
  const os = isWin ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const file = os === 'darwin' ? `cloudflared-darwin-${arch}.tgz` : `cloudflared-${os}-${arch}${isWin ? '.exe' : ''}`;
  const manual = `Скачайте вручную: https://github.com/cloudflare/cloudflared/releases/latest → файл ${file}, переименуйте его в ${exe} и положите в папку tools проекта.`;
  if (!arch) {
    say(`Не знаю, какой cloudflared нужен для этого компьютера. ${manual}`);
    return null;
  }
  say('Скачиваю cloudflared — программу для доступа из интернета (один раз, около 40 МБ)…');
  try {
    const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${file}`, { signal: AbortSignal.timeout(600000) });
    if (!res.ok) throw new Error(`ошибка загрузки ${res.status}`);
    fs.mkdirSync(TOOLS, { recursive: true });
    const data = Buffer.from(await res.arrayBuffer());
    if (file.endsWith('.tgz')) {
      const archive = path.join(TOOLS, file);
      fs.writeFileSync(archive, data);
      const ok = unpack(archive, TOOLS);
      fs.rmSync(archive, { force: true });
      if (!ok || !fs.existsSync(local)) throw new Error('не удалось распаковать архив');
    } else fs.writeFileSync(local, data);
    if (!isWin) fs.chmodSync(local, 0o755);
    say(`Готово: ${path.relative(ROOT, local)}`);
    return local;
  } catch (e) {
    say(`Не получилось скачать cloudflared (${e.message}). ${manual}`);
    return null;
  }
}

function shareNotes(url, env, via) {
  const line = '='.repeat(Math.max(48, url.length + 22));
  say(`\n${line}\n  Ссылка для друга:  ${url}\n${line}`);
  if (via === 'pinggy') say('  • По этой ссылке сначала откроется страница Pinggy на английском — нужно нажать «Enter site». Ссылка работает 60 минут.');
  say('  • Работает, пока открыто это окно и включён компьютер. При следующем запуске ссылка будет другой.');
  say('  • Сами тоже откройте сайт по этой ссылке (войти придётся заново) — тогда «Скопировать ссылку»');
  say('    на урок даст адрес, который откроется у друга.');
  if (/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.LIVEKIT_URL || '')) {
    say('  • Видео и доска в уроке у друга НЕ заработают: видеосервер на вашем компьютере не виден из интернета.');
    say('    Подключите бесплатный LiveKit Cloud — README, раздел «Показать сайт другу», шаг 2.');
  }
  const mail = (env.SMTP_USER || '').trim() && (env.SMTP_PASS || '').trim();
  if (!mail) {
    say('  • Почта не настроена: код для регистрации друга появится в этом окне (строка «Код для …») —');
    say('    продиктуйте его другу.');
  } else say('  • Если письмо с кодом не дойдёт, код появится в этом окне (строка «Код для …») — продиктуйте его другу.');
  say('  • По ссылке на урок друг может зайти как гость — без регистрации.');
  say('  • Ссылка или видео работают с перебоями — README, «Показать сайт другу» → «Если связь рвётся».');
  say(`\nОстановить — Ctrl+C в этом окне.\n`);
}

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

  // Временная ссылка: Cloudflare, а если не вышло — запасные сервисы (SHARE_VIA в .env.local — с какого начать)
  fs.mkdirSync(TOOLS, { recursive: true });
  const link = await openTunnel(children, (env.SHARE_VIA || '').trim().toLowerCase());
  if (!link) {
    say(`\nСсылку получить не удалось. Сайт работает только на этом компьютере: ${SITE}`);
    say('Что попробовать: подождать 10–15 минут и запустить share-windows.bat снова; включить или выключить VPN;');
    say('разрешить программы cloudflared, node и ssh в антивирусе. Подробности — в папке tools (файлы *.log).\n');
    return;
  }
  link.proc.on('exit', (code) =>
    say(`\nДоступ из интернета закрылся (${link.name}, код ${code}). Чтобы получить новую ссылку, закройте это окно и запустите share-windows.bat снова.`),
  );
  // Новому адресу нужно несколько секунд, чтобы заработать
  await sleep(3000);
  const ok = await waitUp(`${link.url}/api/health`, 40000);
  shareNotes(link.url, env, link.id);
  if (ok) openBrowser(link.url);
  else say('Ссылка может заработать не сразу — подождите минуту и обновите страницу.\n');
}

// --- Сервисы временных ссылок: по очереди Cloudflare → Tunnelmole → Pinggy ---
// «api.trycloudflare.com» — служебный адрес Cloudflare из сообщений об ошибках, а не ссылка.
const CF_LINK = /https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/;
const TM_LINK = /https:\/\/[a-z0-9-]+\.tunnelmole\.net/;
const PINGGY_LINK = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.[a-z0-9.-]*pinggy[a-z0-9-]*\.(?:link|net|online|io)/;

/** Tunnelmole — запасной сервис ссылок: программа на Node.js, ставится в папку tools один раз. */
function findTunnelmole() {
  const cli = path.join(TOOLS, 'tunnelmole', 'node_modules', 'tunnelmole', 'dist', 'bin', 'tunnelmole.js');
  if (fs.existsSync(cli)) return cli;
  say('Скачиваю Tunnelmole — запасную программу для ссылки (один раз, около 20 МБ)…');
  fs.mkdirSync(path.join(TOOLS, 'tunnelmole'), { recursive: true });
  const cmd = 'npm install --prefix tools/tunnelmole --no-save --no-audit --no-fund --loglevel=error tunnelmole@2';
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true });
  if (r.status === 0 && fs.existsSync(cli)) return cli;
  say('Не получилось скачать Tunnelmole.');
  return null;
}

function hasSsh() {
  const r = spawnSync('ssh', ['-V'], { stdio: 'ignore', windowsHide: true });
  if (!r.error && r.status === 0) return true;
  say('Pinggy не подходит: на компьютере нет программы ssh.');
  return false;
}

const TUNNELS = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    log: 'cloudflared.log',
    re: CF_LINK,
    tries: 2,
    start: async () => {
      const bin = await findCloudflared();
      return bin && { bin, args: ['tunnel', '--no-autoupdate', '--url', SITE] };
    },
  },
  {
    id: 'tunnelmole',
    name: 'Tunnelmole',
    log: 'tunnelmole.log',
    re: TM_LINK,
    tries: 1,
    start: async () => {
      const cli = findTunnelmole();
      return cli && { bin: process.execPath, args: [cli, '3000'], env: { ...process.env, TUNNELMOLE_TELEMETRY: '0' } };
    },
  },
  {
    id: 'pinggy',
    name: 'Pinggy',
    log: 'pinggy.log',
    re: PINGGY_LINK,
    tries: 1,
    start: async () => {
      if (!hasSsh()) return null;
      const opts = ['StrictHostKeyChecking=accept-new', 'BatchMode=yes', 'ServerAliveInterval=30', 'ServerAliveCountMax=3', 'ExitOnForwardFailure=yes'];
      return { bin: 'ssh', args: ['-T', '-p', '443', ...opts.flatMap((o) => ['-o', o]), '-R0:localhost:3000', 'a.pinggy.io'] };
    },
  },
];

/** Запускает программу-туннель и ждёт в её сообщениях ссылку. */
function waitLink(how, re, logFile, ms) {
  return new Promise((resolve) => {
    let log = '';
    let done = false;
    let proc;
    const finish = (url, extra = {}) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!url) {
        try {
          proc?.kill();
        } catch {}
      }
      resolve({ url, proc, log, ...extra });
    };
    const timer = setTimeout(() => finish('', { timeout: true }), ms);
    try {
      proc = spawn(how.bin, how.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: how.env || process.env });
    } catch (e) {
      log = e.message;
      return finish('');
    }
    const onData = (buf) => {
      const text = buf.toString();
      fs.appendFileSync(logFile, text);
      if (done) return;
      log += text;
      const m = log.match(re);
      if (m) finish(m[0]);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
      log += `\n${e.message}`;
      finish('');
    });
    proc.on('exit', (code) => {
      log += `\n(код ${code})`;
      finish('');
    });
  });
}

/** Понятная причина, почему сервис не выдал ссылку, — по его сообщениям. again: есть ли смысл сразу повторить. */
function tunnelProblem(r, t) {
  const log = r.log.replace(/\x1b\[[0-9;]*m/g, '');
  if (/1015|429|Too Many Requests/i.test(log))
    return { why: `${t.name} временно не выдаёт новые ссылки — слишком много запусков подряд (бывает, если у провайдера один адрес на много людей). Обычно проходит за 10–15 минут`, again: false };
  if (/x509|certificate/i.test(log)) return { why: 'мешает антивирус (проверка защищённых соединений) — разрешите эту программу в антивирусе', again: false };
  if (/ENOENT|EACCES|EPERM|not a valid|cannot execute/i.test(log))
    return { why: 'программа не запускается (возможно, её заблокировал антивирус). Удалите её из папки tools — она скачается заново', again: false };
  if (r.timeout) return { why: 'не ответил за минуту — связь с ним плохая (провайдер, VPN или антивирус)', again: false };
  if (/no such host|server misbehaving|ENOTFOUND|EAI_AGAIN|Could not resolve/i.test(log)) return { why: 'компьютер не нашёл адрес сервиса — проверьте интернет', again: true };
  if (/timeout|timed out|deadline exceeded|i\/o|refused|reset|dial tcp|EOF/i.test(log))
    return { why: 'нет связи с сервисом — часто мешает провайдер, VPN или антивирус', again: true };
  const line = log.split(/\r?\n/).reverse().find((l) => /\bERR\b|failed|error/i.test(l)) || log.split(/\r?\n/).reverse().find((l) => l.trim() && !/^\(код/.test(l));
  return { why: line ? line.replace(/^\S+\s+(ERR|WRN|INF)\s+/, '').trim().slice(0, 200) : 'неизвестная ошибка', again: true };
}

/** Получает временную ссылку: по очереди пробует сервисы, начиная с выбранного в SHARE_VIA. */
async function openTunnel(children, first) {
  const order = [...TUNNELS].sort((a, b) => Number(first.startsWith(b.id)) - Number(first.startsWith(a.id)));
  let tried = false;
  for (const t of order) {
    say(tried ? `\nПробую другой сервис — ${t.name}…` : `\nОткрываю доступ из интернета (${t.name})…`);
    tried = true;
    const how = await t.start();
    if (!how) continue;
    const logFile = path.join(TOOLS, t.log);
    fs.writeFileSync(logFile, '');
    for (let attempt = 1; attempt <= t.tries; attempt++) {
      if (attempt > 1) say(`Пробую ${t.name} ещё раз…`);
      const r = await waitLink(how, t.re, logFile, 60000);
      if (r.url) {
        children.push(r.proc);
        return { url: r.url, proc: r.proc, name: t.name, id: t.id };
      }
      const p = tunnelProblem(r, t);
      say(`${t.name} не выдал ссылку: ${p.why}.`);
      if (!p.again) break;
      await sleep(5000);
    }
  }
  return null;
}

async function main() {
  say(SHARE ? '\nПарта: запускаю сайт и открываю доступ другу\n' : '\nПарта: запускаю сайт\n');
  if (Number(process.versions.node.split('.')[0]) < 20) {
    say(`Нужен Node.js 22 или новее, а у вас ${process.version}. Скачайте версию LTS с https://nodejs.org и запустите снова.`);
    process.exit(1);
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
