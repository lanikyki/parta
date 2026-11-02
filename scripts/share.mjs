// Ссылка для друга: открывает сайт с этого компьютера в интернет (share-windows.bat или npm run share).
// Сервисы ссылок — по очереди, пока какой-нибудь не заработает:
//   Tuna (российский: ссылка постоянная, нужен бесплатный аккаунт) → Cloudflare → Tunnelmole → Pinggy.
// Каждую ссылку скрипт проверяет: открывается ли по ней сайт и проходят ли большие страницы
// (провайдеры в России часто «душат» зарубежные сервисы: начало страницы приходит, а остальное — нет).
// Пока окно открыто, скрипт следит за ссылкой и сам переподключается, если связь пропала.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './check.mjs';
import { clock, copyText, download, isUp, isWin, openBrowser, say, sleep, unpack, waitUp, which } from './util.mjs';

const TOOLS = path.join(ROOT, 'tools');
const SITE = 'http://localhost:3000';
/** Адрес действующей ссылки: по нему сайт делает ссылки в кнопках «Скопировать ссылку» и в письмах. */
const URL_FILE = path.join(TOOLS, 'share-url.txt');
const JOURNAL = path.join(TOOLS, 'share.log');
// Tuna на бесплатном тарифе показывает браузеру страницу-предупреждение; проверкам скрипта она не нужна
const SKIP_WARNING = { 'tuna-skip-browser-warning': '1' };
const ARCH = { x64: 'amd64', arm64: 'arm64', ia32: '386', arm: 'arm' }[process.arch];
const OS = isWin ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
const PROBE_BYTES = 256 * 1024;

const journal = (s) => {
  try {
    fs.appendFileSync(JOURNAL, `${new Date().toISOString()} ${s}\n`);
  } catch {}
};
const plain = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const lastLine = (s) =>
  plain(s)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\(код/.test(l))
    .pop() || '';

/* ───────── Программы для ссылок: скачиваются в папку tools один раз ───────── */

async function findCloudflared() {
  const exe = isWin ? 'cloudflared.exe' : 'cloudflared';
  const local = path.join(TOOLS, exe);
  if (fs.existsSync(local)) return local;
  const found = which('cloudflared');
  if (found) return found;
  const file = OS === 'darwin' ? `cloudflared-darwin-${ARCH}.tgz` : `cloudflared-${OS}-${ARCH}${isWin ? '.exe' : ''}`;
  const manual = `Скачайте вручную: https://github.com/cloudflare/cloudflared/releases/latest → файл ${file}, переименуйте его в ${exe} и положите в папку tools проекта.`;
  if (!ARCH) {
    say(`Не знаю, какой cloudflared нужен для этого компьютера. ${manual}`);
    return null;
  }
  say('Скачиваю cloudflared — программу для ссылки (один раз, около 40 МБ)…');
  try {
    const target = file.endsWith('.tgz') ? path.join(TOOLS, file) : local;
    await download(`https://github.com/cloudflare/cloudflared/releases/latest/download/${file}`, target);
    if (target !== local) {
      const ok = unpack(target, TOOLS);
      fs.rmSync(target, { force: true });
      if (!ok || !fs.existsSync(local)) throw new Error('не удалось распаковать архив');
    }
    if (!isWin) fs.chmodSync(local, 0o755);
    return local;
  } catch (e) {
    say(`Не получилось скачать cloudflared (${e.message}). ${manual}`);
    return null;
  }
}

const TUNA_DIR = path.join(TOOLS, 'tuna');
const TUNA_SUB = path.join(TUNA_DIR, 'subdomain.txt');

async function findTuna() {
  const local = path.join(TUNA_DIR, isWin ? 'tuna.exe' : 'tuna');
  if (fs.existsSync(local)) return local;
  const found = which('tuna');
  if (found) return found;
  const arch = OS === 'linux' && process.arch === 'arm' ? 'armv7' : ARCH;
  const file = `tuna_${OS}_${arch}.${isWin ? 'zip' : 'tar.gz'}`;
  const manual = `Скачайте вручную: https://tuna.am/docs/guides/install/install-cli/ — и положите ${path.basename(local)} в папку tools${path.sep}tuna проекта.`;
  if (!arch) {
    say(`Не знаю, какая программа Tuna нужна для этого компьютера. ${manual}`);
    return null;
  }
  say('Скачиваю Tuna — программу для ссылки (один раз, около 10 МБ)…');
  try {
    const archive = path.join(TUNA_DIR, file);
    await download(`https://releases.tuna.am/tuna/latest/${file}`, archive);
    const ok = unpack(archive, TUNA_DIR);
    fs.rmSync(archive, { force: true });
    if (!ok || !fs.existsSync(local)) throw new Error('не удалось распаковать архив');
    if (!isWin) fs.chmodSync(local, 0o755);
    return local;
  } catch (e) {
    say(`Не получилось скачать Tuna (${e.message}). ${manual}`);
    return null;
  }
}

/** Tunnelmole — программа на Node.js, ставится в папку tools один раз. */
function findTunnelmole() {
  const cli = path.join(TOOLS, 'tunnelmole', 'node_modules', 'tunnelmole', 'dist', 'bin', 'tunnelmole.js');
  if (fs.existsSync(cli)) return cli;
  say('Скачиваю Tunnelmole — программу для ссылки (один раз, около 20 МБ)…');
  fs.mkdirSync(path.join(TOOLS, 'tunnelmole'), { recursive: true });
  const cmd = 'npm install --prefix tools/tunnelmole --no-save --no-audit --no-fund --loglevel=error tunnelmole@2';
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, cwd: ROOT });
  if (r.status === 0 && fs.existsSync(cli)) return cli;
  say('Не получилось скачать Tunnelmole.');
  return null;
}

/* ───────── Tuna: вход в аккаунт и постоянный адрес ───────── */

function tunaEnv(env) {
  const key = (env.TUNA_API_KEY || '').trim();
  return { ...process.env, ...(key ? { TUNA_API_KEY: key } : {}) };
}

function tunaCall(bin, args, env) {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 30000, env, windowsHide: true });
  return { ok: r.status === 0, out: plain(`${r.stdout || ''}\n${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`) };
}

function saveTunaSub(sub) {
  try {
    if (fs.existsSync(TUNA_DIR) && /^[a-z0-9-]+$/.test(sub)) fs.writeFileSync(TUNA_SUB, sub);
  } catch {}
}

/** Постоянный поддомен аккаунта (вида brave-otter-4821): из .env.local, из прошлого запуска или из списка доменов. */
function tunaSubdomain(bin, tenv, env) {
  const own = (env.TUNA_SUBDOMAIN || '').trim().toLowerCase().replace(/\..*$/, '');
  if (/^[a-z0-9-]+$/.test(own)) return own;
  try {
    const saved = fs.readFileSync(TUNA_SUB, 'utf8').trim();
    if (/^[a-z0-9-]+$/.test(saved)) return saved;
  } catch {}
  const r = tunaCall(bin, ['domain', 'list', '--json'], tenv);
  const m = r.ok && r.out.match(/"([a-z]+-[a-z]+-\d{3,5})(?:\.[a-z0-9.-]*tuna\.(?:am|free))?"/);
  if (m) saveTunaSub(m[1]);
  return m ? m[1] : '';
}

/** Вход в Tuna через браузер: программа даёт ссылку и код, человек подтверждает вход на сайте Tuna. */
function tunaLogin(bin, tenv, logFile, insecure) {
  return new Promise((resolve) => {
    const args = ['login', '--no-browser', '--hostname=parta', ...(insecure ? ['--insecure-storage'] : [])];
    let log = '';
    let shown = false;
    let proc;
    try {
      proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: tenv, windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, log: e.message });
    }
    const quit = () => proc.kill();
    process.once('exit', quit); // окно закрыли, пока ждали входа
    const timer = setTimeout(() => {
      say('Вход в Tuna не подтверждён за 10 минут.');
      proc.kill();
    }, 600000);
    const onData = (buf) => {
      const text = plain(buf.toString());
      fs.appendFileSync(logFile, text);
      log += text;
      const m = !shown && log.match(/https:\/\/my\.tuna\.am\/[^\s"']*user_code=([A-Za-z0-9-]+)/);
      if (!m) return;
      shown = true;
      say('Сейчас в браузере откроется страница Tuna. Войдите — через Яндекс, Mail.ru, Google или по почте');
      say(`(если аккаунта нет — зарегистрируйтесь, это бесплатно). Проверьте, что на странице код ${m[1]}, и подтвердите вход.`);
      say(`Если страница не открылась, откройте её сами: ${m[0]}`);
      say('Жду подтверждения (до 10 минут)…');
      openBrowser(m[0]);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
      log += `\n${e.message}`;
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      process.off('exit', quit);
      resolve({ ok: code === 0, log });
    });
  });
}

async function prepareTuna({ env, first, logFile }) {
  const bin = await findTuna();
  if (!bin) return null;
  const tenv = tunaEnv(env);
  const who = tunaCall(bin, ['whoami'], tenv);
  if (!who.ok) {
    if (!/log ?in|session|api.?key|unauthori|401|token/i.test(who.out)) {
      say(`Tuna не отвечает: ${problem({ log: who.out }, PROVIDERS.tuna).why}.`);
      return null;
    }
    if (!first) {
      say('Tuna пропускаю: для неё нужен вход в бесплатный аккаунт (README, «Показать сайт другу»).');
      return null;
    }
    say('\nДля ссылки Tuna нужен бесплатный аккаунт. Войти нужно один раз — потом всё будет само, а ссылка не будет меняться.');
    let r = await tunaLogin(bin, tenv, logFile, false);
    if (!r.ok && /keyring|secret service|credential|dbus|keychain/i.test(r.log)) r = await tunaLogin(bin, tenv, logFile, true);
    if (!r.ok) {
      say('Вход в Tuna не выполнен — пробую другие сервисы.');
      return null;
    }
    say('Вход в Tuna выполнен.');
  }
  const sub = tunaSubdomain(bin, tenv, env);
  const args = ['http', '3000', '--inspect=false', '--log=stdout', '--no-colors'];
  return { bin, args: sub ? [...args, `--subdomain=${sub}`] : args, env: tenv, sub };
}

/* ───────── Список сервисов ───────── */

const PROVIDERS = {
  tuna: {
    id: 'tuna',
    name: 'Tuna',
    log: 'tuna.log',
    re: /Forwarding\s+(https:\/\/[a-z0-9.-]+(?::\d+)?)/i,
    tries: 3,
    prepare: prepareTuna,
    // Без постоянного поддомена Tuna подсказывает его в сообщениях — запоминаем на следующие запуски
    onOutput(text) {
      const m = text.match(/permanent free domain[^\n]*?--subdomain=([a-z0-9-]+)/i) || text.match(/permanent free domain:\s*([a-z0-9-]+)\./i);
      if (m) saveTunaSub(m[1].toLowerCase());
    },
    // Поддомен не подошёл (например, другой аккаунт) — пробуем со случайным адресом
    fix(r, how) {
      if (!how.sub || !/domain/i.test(r.log)) return null;
      fs.rmSync(TUNA_SUB, { force: true });
      return { ...how, sub: '', args: how.args.filter((a) => !a.startsWith('--subdomain=')) };
    },
  },
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare',
    log: 'cloudflared.log',
    // «api.trycloudflare.com» — служебный адрес Cloudflare из сообщений об ошибках, а не ссылка
    re: /https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/,
    tries: 2,
    async prepare() {
      const bin = await findCloudflared();
      return bin && { bin, args: ['tunnel', '--no-autoupdate', '--url', SITE] };
    },
  },
  tunnelmole: {
    id: 'tunnelmole',
    name: 'Tunnelmole',
    log: 'tunnelmole.log',
    re: /https:\/\/[a-z0-9-]+\.tunnelmole\.net/,
    tries: 1,
    async prepare() {
      const cli = findTunnelmole();
      return cli && { bin: process.execPath, args: [cli, '3000'], env: { ...process.env, TUNNELMOLE_TELEMETRY: '0' } };
    },
  },
  pinggy: {
    id: 'pinggy',
    name: 'Pinggy',
    log: 'pinggy.log',
    re: /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.[a-z0-9.-]*pinggy[a-z0-9-]*\.(?:link|net|online|io)/,
    tries: 1,
    async prepare() {
      const r = spawnSync('ssh', ['-V'], { stdio: 'ignore', windowsHide: true });
      if (r.error || r.status !== 0) {
        say('Pinggy не подходит: на компьютере нет программы ssh.');
        return null;
      }
      const opts = ['StrictHostKeyChecking=accept-new', 'BatchMode=yes', 'ServerAliveInterval=30', 'ServerAliveCountMax=3', 'ExitOnForwardFailure=yes'];
      return { bin: 'ssh', args: ['-T', '-p', '443', ...opts.flatMap((o) => ['-o', o]), '-R0:localhost:3000', 'a.pinggy.io'] };
    },
  },
};
const DEFAULT_ORDER = ['tuna', 'cloudflare', 'tunnelmole', 'pinggy'];
const ALIASES = { cf: 'cloudflare', cloudflared: 'cloudflare', trycloudflare: 'cloudflare', 'tuna.am': 'tuna', tm: 'tunnelmole' };

/** Порядок сервисов: выбранные в SHARE_SERVICE — первыми, остальные — следом. */
export function providerOrder(choice = '') {
  const want = String(choice)
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((s) => ALIASES[s] || s)
    .filter((s) => PROVIDERS[s]);
  return [...new Set([...want, ...DEFAULT_ORDER])].map((id) => PROVIDERS[id]);
}

/* ───────── Запуск программы-туннеля и проверка ссылки ───────── */

/** Запускает программу-туннель и ждёт в её сообщениях ссылку. */
function waitLink(how, p, logFile, ms) {
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
      const text = plain(buf.toString());
      try {
        fs.appendFileSync(logFile, text);
      } catch {}
      p.onOutput?.(text);
      if (done) return;
      log += text;
      const m = log.match(p.re);
      if (m) finish((m[1] || m[0]).replace(/[.,;]+$/, ''));
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

/** Понятная причина, почему сервис не выдал ссылку. again — есть ли смысл повторить, wait — через сколько. */
function problem(r, p) {
  const log = plain(r.log);
  if (p.id === 'tuna' && /limit|exceed|maximum|already (running|in use|connected)|лимит/i.test(log))
    return { why: 'у Tuna уже открыта другая ссылка (на бесплатном тарифе — одна). Если открыто ещё одно окно со ссылкой — закройте его', again: true, wait: 20000, busy: true };
  if (/1015|429|Too Many Requests/i.test(log))
    return { why: `${p.name} временно не выдаёт новые ссылки — слишком много запусков подряд (бывает, если у провайдера один адрес на много людей). Обычно проходит за 10–15 минут`, again: false };
  if (/x509|certificate/i.test(log)) return { why: 'мешает антивирус (проверка защищённых соединений) — разрешите эту программу в антивирусе', again: false };
  if (/ENOENT|EACCES|EPERM|not a valid|cannot execute|is not recognized/i.test(log))
    return { why: 'программа не запускается (возможно, её заблокировал антивирус). Удалите её из папки tools — она скачается заново', again: false };
  if (r.timeout) return { why: 'не ответил за минуту — связь с ним плохая (провайдер, VPN или антивирус)', again: false };
  if (/no such host|server misbehaving|ENOTFOUND|EAI_AGAIN|Could not resolve/i.test(log)) return { why: 'компьютер не нашёл адрес сервиса — проверьте интернет', again: true };
  if (/timeout|timed out|deadline exceeded|i\/o|refused|reset|dial tcp|EOF|websocket/i.test(log))
    return { why: 'нет связи с сервисом — часто мешает провайдер, VPN или антивирус', again: true };
  const line = log
    .split(/\r?\n/)
    .reverse()
    .find((l) => /\bERR\b|level=(error|fatal)|failed|error/i.test(l));
  const why = (line || lastLine(log))
    .replace(/^time="[^"]*"\s*/, '')
    .replace(/^\S+\s+(ERR|WRN|INF)\s+/, '')
    .trim()
    .slice(0, 200);
  return { why: why || 'неизвестная ошибка', again: true };
}

/** Скачивает через ссылку 256 КБ: так видно, проходят ли через неё большие страницы, а не только короткие ответы. */
async function probe(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${url}/api/health?probe=1&t=${t0}`, { headers: SKIP_WARNING, signal: AbortSignal.timeout(25000) });
    if (!r.ok || !r.body) return { ok: false, why: `ответ ${r.status}` };
    // Сайт старой версии (без проверки скорости) — проверить нечем, считаем, что всё хорошо
    if (!(r.headers.get('content-type') || '').includes('octet-stream')) {
      await r.body.cancel().catch(() => {});
      return { ok: true };
    }
    let got = 0;
    for await (const chunk of r.body) got += chunk.length;
    const kbps = Math.round(got / 1024 / Math.max(0.1, (Date.now() - t0) / 1000));
    return { ok: got >= PROBE_BYTES, kbps, why: got < PROBE_BYTES ? `дошло ${Math.round(got / 1024)} КБ из 256` : '' };
  } catch (e) {
    return { ok: false, why: e?.name === 'TimeoutError' ? 'за 25 секунд не дошло 256 КБ' : e?.message || 'обрыв' };
  }
}

/** Открывается ли сайт по ссылке и проходят ли большие ответы. */
async function verify(url) {
  // Новому адресу нужно несколько секунд, чтобы заработать
  await sleep(2000);
  if (!(await waitUp(`${url}/api/health`, 45000, SKIP_WARNING))) return { ok: false, why: '' };
  const pr = await probe(url);
  journal(`проверка ${url}: ${pr.ok ? 'ok' : 'плохо'} ${pr.kbps ?? '-'} КБ/с ${pr.why || ''}`);
  return pr.ok ? { ok: true, kbps: pr.kbps } : { ok: false, slow: true, why: pr.why };
}

function killLink(link) {
  try {
    link?.proc?.kill();
  } catch {}
}

async function startProvider(p, ctx) {
  const logFile = path.join(TOOLS, p.log);
  fs.writeFileSync(logFile, '');
  let how = await p.prepare({ ...ctx, logFile });
  if (!how) return null;
  for (let attempt = 1; attempt <= p.tries; attempt++) {
    if (attempt > 1) say(`Пробую ${p.name} ещё раз…`);
    const r = await waitLink(how, p, logFile, 60000);
    if (r.url) return { id: p.id, name: p.name, url: r.url, proc: r.proc, provider: p };
    journal(`${p.name}: нет ссылки. ${lastLine(r.log)}`);
    const prob = problem(r, p);
    const fixed = !prob.busy && p.fix?.(r, how);
    if (fixed) {
      how = fixed;
      continue;
    }
    say(`${p.name} не выдал ссылку: ${prob.why}.`);
    if (!prob.again || attempt === p.tries) break;
    await sleep(prob.wait || 5000);
  }
  return null;
}

/** Есть ли вообще интернет (чтобы при обрыве не перебирать сервисы впустую). */
async function online() {
  for (const u of ['https://ya.ru', 'https://www.google.com', 'https://github.com']) if (await isUp(u, 8000)) return true;
  return false;
}

/** Перебирает сервисы по порядку и возвращает первую ссылку, которая прошла проверку. */
async function openLink(order, ctx) {
  let spare = null; // ссылка, по которой сайт открывается, но медленно, — на крайний случай
  for (const [i, p] of order.entries()) {
    say(i ? `\nПробую другой сервис — ${p.name}…` : `\nОткрываю доступ из интернета (${p.name})…`);
    const link = await startProvider(p, { ...ctx, first: i === 0 });
    if (!link) continue;
    say(`Ссылка получена, проверяю, как через неё открывается сайт…`);
    const v = await verify(link.url);
    if (v.ok) {
      killLink(spare);
      return link;
    }
    if (v.slow && !spare) {
      say(`Через ${p.name} сайт открывается, но большие страницы почти не проходят (${v.why}) — похоже, провайдер ограничивает этот сервис.`);
      spare = { ...link, slow: true };
      continue;
    }
    say(`Через ${p.name} сайт не открывается${v.why ? ` (${v.why})` : ''}.`);
    killLink(link);
  }
  return spare;
}

/* ───────── Сообщения в окне ───────── */

function box(title, url) {
  const line = '='.repeat(Math.max(48, url.length + title.length + 6));
  say(`\n${line}\n  ${title}:  ${url}\n${line}`);
}

function shareNotes(link, env, copied, video) {
  box('Ссылка для друга', link.url);
  if (copied) say('  • Ссылка уже скопирована — вставьте её другу в сообщение (Ctrl+V).');
  if (link.id === 'tuna') {
    say('  • При первом заходе друг увидит страницу Tuna с предупреждением — пусть нажмёт кнопку перехода на сайт.');
    say(/^[a-z]+-[a-z]+-\d{3,5}\.(?:[a-z]+\.)?tuna\.(?:am|free)$/.test(new URL(link.url).hostname) ? '  • Ссылка постоянная: в следующий раз она будет такой же.' : '  • В следующий раз ссылка, скорее всего, станет постоянной (Tuna выдаёт свой адрес каждому аккаунту).');
  } else if (link.id === 'pinggy') say('  • По ссылке сначала откроется страница Pinggy на английском — нужно нажать «Enter site». Ссылка работает 60 минут.');
  else say('  • При следующем запуске ссылка будет другой.');
  say('  • Работает, пока открыто это окно и включён компьютер. Если связь пропадёт, скрипт переподключится сам,');
  say('    а если адрес сменится — покажет здесь новую ссылку.');
  say('  • Кнопки «Скопировать ссылку» на сайте сразу дают адрес с этой ссылкой — даже если у вас сайт открыт как localhost.');
  if (video === 'local') say('  • Видео в уроке идёт через эту же ссылку и ваш компьютер — VPN и LiveKit Cloud не нужны. VPN лучше выключить.');
  else if (/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.LIVEKIT_URL || '')) {
    say('  • Видео в уроке у друга не заработает: видеосервер не запустился (подробности — в tools/livekit.log).');
    say('    Доска и чат работают.');
  }
  const mail = (env.SMTP_USER || '').trim() && (env.SMTP_PASS || '').trim();
  if (!mail) say('  • Почта не настроена: код для регистрации друга появится в этом окне (строка «Код для …») — продиктуйте его другу.');
  else say('  • Если письмо с кодом не дойдёт, код появится в этом окне (строка «Код для …») — продиктуйте его другу.');
  say('  • По ссылке на урок друг может зайти как гость — без регистрации.');
  if (link.slow) {
    say('  • ВНИМАНИЕ: через эту ссылку большие страницы проходят плохо — у друга сайт может долго грузиться.');
    say('    Надёжнее всего ссылка Tuna (российский сервис) — README, «Показать сайт другу» → «Если связь рвётся».');
  }
  say(`\nОстановить — Ctrl+C в этом окне (или просто закройте его).\n`);
}

/* ───────── Главное: ссылка + присмотр за ней ───────── */

export async function startShare({ env, children, video = '' }) {
  fs.mkdirSync(TOOLS, { recursive: true });
  const state = { env, children, video, order: providerOrder(env.SHARE_SERVICE), link: null, busy: false, stopped: false, drops: [] };
  process.on('exit', () => {
    state.stopped = true;
    try {
      fs.rmSync(URL_FILE, { force: true });
    } catch {}
  });
  journal(`--- запуск, порядок: ${state.order.map((p) => p.id).join(', ')}`);
  const link = await openLink(state.order, { env });
  if (!link) {
    say(`\nСсылку получить не удалось. Сайт работает только на этом компьютере: ${SITE}`);
    say('Что попробовать: подождать 10–15 минут и запустить share-windows.bat снова; включить или выключить VPN;');
    say('разрешить программы tuna, cloudflared, node и ssh в антивирусе. Подробности — в папке tools (файлы *.log).\n');
    return;
  }
  accept(state, link, true);
  watch(state);
}

function saveUrl(url) {
  try {
    fs.writeFileSync(URL_FILE, url);
  } catch {}
}

function accept(state, link, first) {
  const before = state.lastUrl;
  state.link = link;
  state.lastUrl = link.url;
  state.children.push(link.proc);
  journal(`ссылка ${link.url} (${link.name})${link.slow ? ' медленная' : ''}`);
  link.proc.on('exit', (code) => {
    if (state.link === link && !state.stopped) reconnect(state, `программа ${link.name} закрылась, код ${code}`);
  });
  saveUrl(link.url);
  const copied = copyText(link.url);
  if (first) {
    shareNotes(link, state.env, copied, state.video);
    openBrowser(link.url);
  } else if (before !== link.url) {
    box('НОВАЯ ссылка для друга', link.url);
    say(`  Старая ссылка больше не работает — отправьте другу новую.${copied ? ' Она уже скопирована: вставьте её в сообщение (Ctrl+V).' : ''}`);
    if (link.id === 'pinggy') say('  По ссылке Pinggy сначала откроется страница на английском — нужно нажать «Enter site».');
    if (link.slow) say('  Через эту ссылку большие страницы проходят плохо — сайт у друга может грузиться долго.');
    say('');
  } else say(`[${clock()}] Ссылка снова работает — адрес прежний, другу ничего делать не нужно.\n`);
}

async function reconnect(state, why) {
  if (state.busy || state.stopped) return;
  state.busy = true;
  const old = state.link;
  state.link = null;
  killLink(old);
  say(`\n[${clock()}] Ссылка перестала работать (${why}). Переподключаю…`);
  journal(`обрыв: ${why}`);
  try {
    if (!(await online())) {
      say('Похоже, пропал интернет на этом компьютере. Как только он появится, ссылка восстановится — окно не закрывайте.');
      return;
    }
    let order = state.order;
    if (old) {
      const now = Date.now();
      state.drops = [...state.drops.filter((t) => now - t < 15 * 60000), now];
      const rest = order.filter((p) => p.id !== old.id);
      // Сервис рвётся часто (3 раза за 15 минут) — сначала пробуем другие
      if (state.drops.length >= 3) {
        say(`${old.name} у вас часто обрывается — попробую другие сервисы.`);
        state.drops = [];
        order = [...rest, old.provider];
      } else order = [old.provider, ...rest];
    }
    await sleep(2000);
    const link = await openLink(order, { env: state.env });
    if (link && !state.stopped) accept(state, link, false);
    else if (!link) say('Пока не получилось. Попробую снова через полминуты — окно не закрывайте.');
  } finally {
    state.busy = false;
  }
}

/** Раз в 30 секунд проверяет ссылку; три неудачи подряд — переподключение. */
async function watch(state) {
  let fails = 0;
  while (!state.stopped) {
    await sleep(30000);
    if (state.busy || state.stopped) continue;
    if (!state.link) {
      await reconnect(state, 'повторная попытка');
      continue;
    }
    const url = state.link.url;
    if (await isUp(`${url}/api/health`, 15000, SKIP_WARNING)) {
      fails = 0;
      saveUrl(url); // сайт верит этому файлу, только пока он свежий (скрипт мог быть закрыт аварийно)
      continue;
    }
    // Не отвечает сам сайт на этом компьютере — ссылка тут ни при чём
    if (!(await isUp(`${SITE}/api/health`, 5000))) continue;
    if (++fails >= 3 && state.link?.url === url) {
      fails = 0;
      await reconnect(state, 'не открывается уже полторы минуты');
    }
  }
}
