// Видеосервер LiveKit на этом компьютере.
//  • Для себя (start-windows.bat): обычный режим разработки на localhost:7880.
//  • Для показа другу (share-windows.bat): видео идёт через ту же ссылку, что и сайт (Tuna — российский
//    сервис), а сами видео и звук — напрямую между компьютерами. Ни LiveKit Cloud, ни VPN не нужны:
//    зарубежные облака российские провайдеры часто замедляют или блокируют.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './check.mjs';
import { STUN_SERVERS, isPrivateIp, openPorts, stunProbe } from './router.mjs';
import { download, isUp, isWin, say, sleep, unpack, waitUp, which } from './util.mjs';

const TOOLS = path.join(ROOT, 'tools');
/** Порты видеосервера для показа другу: подключение (только внутри компьютера), видео по TCP и по UDP. */
export const SHARE_PORTS = { signal: 7890, tcp: 7891, udp: 7892 };

export async function findLiveKit() {
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

/** Сетевые адаптеры VPN (WireGuard, OpenVPN, Amnezia, Outline, v2ray/sing-box в режиме TUN…): через них видео у друга может не пройти. */
function vpnAdapters() {
  const re = /vpn|wireguard|^wg\d|^tun\d|^tap|outline|amnezia|hiddify|v2ray|xray|sing-?(box|tun)|clash|nekoray|wintun|happ/i;
  return Object.entries(os.networkInterfaces())
    .filter(([name, list]) => re.test(name) && list?.some((a) => !a.internal))
    .map(([name]) => name);
}

/** Видеосервер с прошлого запуска мог остаться работать (окно закрыли аварийно) — он занимает порты. */
function killStale() {
  if (isWin) spawnSync('taskkill', ['/F', '/IM', 'livekit-server.exe'], { stdio: 'ignore', windowsHide: true });
  else spawnSync('pkill', ['-x', 'livekit-server'], { stdio: 'ignore' });
}

function shareConfig() {
  const p = SHARE_PORTS;
  return [
    '# Создаётся заново при каждом запуске share-windows.bat — править не нужно.',
    `port: ${p.signal}`,
    'bind_addresses:',
    '  - 127.0.0.1',
    'rtc:',
    `  udp_port: ${p.udp}`,
    `  tcp_port: ${p.tcp}`,
    '  use_external_ip: false',
    '  advertise_internal_ip: true',
    '  stun_servers:',
    ...STUN_SERVERS.slice(0, 3).map((s) => `    - ${s}`),
    'room:',
    '  empty_timeout: 300',
    '  departure_timeout: 20',
    '  max_participants: 30',
    'logging:',
    '  level: info',
    '',
  ].join('\n');
}

/**
 * Запускает видеосервер для показа другу. Возвращает null, если не получилось (тогда сайт берёт
 * видео из настроек .env.local), или { env, signal, proc, close }:
 *   env — настройки для сайта (адрес и новые случайные ключи), signal — куда «дверь» шлёт /rtc,
 *   close() — закрыть порты на роутере при выходе.
 */
export async function startShareVideo({ journal = () => {} } = {}) {
  const bin = await findLiveKit();
  if (!bin) return null;
  const p = SHARE_PORTS;
  if (await isUp(`http://127.0.0.1:${p.signal}`)) {
    killStale();
    await sleep(1500);
  }
  say('\nГотовлю видео: свой видеосервер на этом компьютере (без LiveKit Cloud и VPN)…');
  let stun = await stunProbe(p.udp);
  if (stun.busy) {
    killStale();
    await sleep(1500);
    stun = await stunProbe(p.udp);
  }
  const upnp = await openPorts([
    ['UDP', p.udp],
    ['TCP', p.tcp],
  ]).catch(() => ({ ok: false, why: 'error' }));
  journal(`видео: stun ${stun.ip || '-'} порты ${stun.ports.join('/') || '-'}; upnp ${upnp.ok ? `ok ${upnp.externalIp}` : upnp.why}`);

  // Как друзья будут доставать до видеосервера
  const direct = upnp.ok && !isPrivateIp(upnp.externalIp);
  const nodeIp = direct ? upnp.externalIp : '';
  const vpn = direct && stun.ip && stun.ip !== upnp.externalIp;
  const cgnat = upnp.ok && isPrivateIp(upnp.externalIp);
  const keepsPort = stun.ports.length >= 2 && stun.ports.every((x) => x === stun.ports[0]);

  const key = `parta${crypto.randomBytes(4).toString('hex')}`;
  const secret = crypto.randomBytes(24).toString('base64url');
  const cfg = path.join(TOOLS, 'livekit-share.yaml');
  fs.mkdirSync(TOOLS, { recursive: true });
  fs.writeFileSync(cfg, shareConfig());
  const logFd = fs.openSync(path.join(TOOLS, 'livekit.log'), 'a');
  const args = ['--config', cfg, ...(nodeIp ? ['--node-ip', nodeIp] : [])];
  const proc = spawn(bin, args, { stdio: ['ignore', logFd, logFd], windowsHide: true, env: { ...process.env, LIVEKIT_KEYS: `${key}: ${secret}` } });
  let failed = '';
  proc.on('error', (e) => (failed = e.message));
  if (!(await waitUp(`http://127.0.0.1:${p.signal}`, 20000)) || failed) {
    say(`Видеосервер не запустился${failed ? ` (${failed})` : ''} — подробности в tools/livekit.log.`);
    try {
      proc.kill();
    } catch {}
    await upnp.close?.();
    return null;
  }

  // Что получилось — коротко и по-человечески
  if (direct) {
    say('[OK] Видео: роутер сам открыл порты для видеосервера — видео будет работать у друзей с любого интернета.');
    if (vpn) say('[!] Похоже, на этом компьютере включён VPN. Выключите его, иначе видео у друга не подключится.');
  } else if (cgnat) {
    say('[!] Видео: у вашего интернета нет своего внешнего адреса (так бывает у части провайдеров) — видео заработает не у всех.');
    say('    Если у друга видео не подключится: README → «Видео без VPN» → «Если видео у друга не подключается».');
  } else if (!stun.ip) {
    say('[!] Видео: не удалось узнать адрес компьютера в интернете — видео у друга может не подключиться.');
    say('    Проверьте интернет и выключите VPN. Подробнее: README → «Видео без VPN».');
  } else if (keepsPort) {
    say('[OK] Видео: видеосервер работает. Роутер не открыл порты сам (UPnP выключен), но ваша сеть обычно пропускает видео.');
    say('    Если у друга видео не подключится (чаще с мобильным интернетом) — включите UPnP в роутере: README → «Видео без VPN».');
  } else {
    say('[!] Видео: роутер не открыл порты (UPnP выключен), а сеть строгая — видео у друга может не подключиться.');
    say('    Включите UPnP в настройках роутера: README → «Видео без VPN».');
  }
  const vpnNames = vpnAdapters();
  if (vpnNames.length && !vpn)
    say(`[!] Похоже, на этом компьютере работает VPN (${vpnNames.slice(0, 2).join(', ')}). Если у друга не будет видео — выключите VPN на время урока.`);
  if (isWin) say('    Если Windows спросит, разрешить ли livekit-server доступ к сети, — нажмите «Разрешить доступ».');

  return {
    proc,
    signal: { host: '127.0.0.1', port: p.signal },
    env: { LIVEKIT_URL: `ws://127.0.0.1:${p.signal}`, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, LIVEKIT_PUBLIC_URL: '/' },
    close: async () => {
      await upnp.close?.();
    },
  };
}
