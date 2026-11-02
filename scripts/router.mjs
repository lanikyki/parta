// Сеть для видеосервера на этом компьютере: внешний адрес (STUN) и открытие портов на роутере (UPnP).
// Друзья подключаются к видео напрямую к вашему компьютеру, поэтому роутер должен пропускать
// входящие соединения на порты видеосервера. Большинство домашних роутеров умеют открывать порты
// по просьбе программ (UPnP) — так и делаем; если UPnP выключен, видео часто всё равно проходит
// («пробивание» NAT), но не во всех сетях.
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import http from 'node:http';
import os from 'node:os';

/** Серверы STUN: подсказывают, с какого адреса и порта нас видно из интернета. */
export const STUN_SERVERS = ['stun.l.google.com:19302', 'stun.sipnet.ru:3478', 'stun.cloudflare.com:3478', 'stun1.l.google.com:19302'];

const PRIVATE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.)/;
export const isPrivateIp = (ip) => !ip || PRIVATE.test(ip);

/** IPv4-адреса компьютера в локальных сетях (без служебных). */
export function localIps() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a.address);
}

/* ───────── STUN ───────── */

function stunRequest(sock, server, ms = 2500) {
  const [host, port] = server.split(':');
  const id = crypto.randomBytes(12);
  const msg = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00, 0x21, 0x12, 0xa4, 0x42]), id]);
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), ms);
    const onMsg = (m) => {
      if (m.length < 20 || !m.subarray(8, 20).equals(id)) return;
      let i = 20;
      let found = null;
      while (i + 4 <= m.length) {
        const type = m.readUInt16BE(i);
        const len = m.readUInt16BE(i + 2);
        if ((type === 0x0020 || type === 0x8020) && m[i + 5] === 0x01) {
          const p = m.readUInt16BE(i + 6) ^ 0x2112;
          const ip = [0, 1, 2, 3].map((k) => m[i + 8 + k] ^ [0x21, 0x12, 0xa4, 0x42][k]).join('.');
          found = { ip, port: p };
        } else if (type === 0x0001 && !found && m[i + 5] === 0x01) {
          found = { ip: [0, 1, 2, 3].map((k) => m[i + 8 + k]).join('.'), port: m.readUInt16BE(i + 6) };
        }
        i += 4 + len + ((4 - (len % 4)) % 4);
      }
      if (found) finish(found);
    };
    const finish = (v) => {
      clearTimeout(timer);
      sock.off('message', onMsg);
      resolve(v);
    };
    sock.on('message', onMsg);
    sock.send(msg, Number(port), host, (e) => e && finish(null));
  });
}

/**
 * Как нас видно из интернета с UDP-порта localPort: { ip, ports: [порт по мнению сервера 1, сервера 2] }.
 * Одинаковые порты — роутер «держит» порт за компьютером (так видео пробивается и без UPnP).
 * busy: true — порт занят другой программой (например, осталось окно от прошлого запуска).
 */
export async function stunProbe(localPort) {
  const sock = dgram.createSocket('udp4');
  const bound = await new Promise((resolve) => {
    sock.once('error', (e) => resolve(e));
    sock.bind(localPort, () => resolve(null));
  });
  if (bound) {
    try {
      sock.close();
    } catch {}
    return { ip: '', ports: [], busy: bound.code === 'EADDRINUSE' };
  }
  sock.on('error', () => {});
  const answers = [];
  for (const s of STUN_SERVERS) {
    const a = await stunRequest(sock, s).catch(() => null);
    if (a) answers.push(a);
    if (answers.length >= 2) break;
  }
  try {
    sock.close();
  } catch {}
  return { ip: answers[0]?.ip || '', ports: answers.map((a) => a.port), busy: false };
}

/* ───────── UPnP ───────── */

const SEARCH = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
];
const WAN = /urn:schemas-upnp-org:service:WAN(IP|PPP)Connection:\d/;

/** Ищет роутеры в домашней сети: { location, local } — адрес описания роутера и наш адрес в этой сети. */
function discover(ms = 2500) {
  const target = { host: process.env.PARTA_SSDP_HOST || '239.255.255.250', port: Number(process.env.PARTA_SSDP_PORT || 1900) };
  const ips = process.env.PARTA_SSDP_HOST ? ['127.0.0.1'] : localIps();
  return new Promise((resolve) => {
    const found = new Map();
    const socks = [];
    const done = () => {
      for (const s of socks)
        try {
          s.close();
        } catch {}
      resolve([...found.values()]);
    };
    for (const ip of ips) {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socks.push(s);
      s.on('error', () => {});
      s.on('message', (msg) => {
        const m = /^location:\s*(\S+)/im.exec(msg.toString());
        if (m && !found.has(m[1])) found.set(m[1], { location: m[1], local: ip });
      });
      s.bind(0, ip, () => {
        for (const st of SEARCH) {
          const req = `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`;
          s.send(req, target.port, target.host, () => {});
        }
      });
    }
    setTimeout(done, ms);
  });
}

function httpText(url, { method = 'GET', headers = {}, body } = {}, ms = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, timeout: ms }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        if (text.length < 300000) text += c;
      });
      res.on('end', () => resolve({ status: res.statusCode || 0, text }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tag = (xml, name) => new RegExp(`<(?:[a-z0-9]+:)?${name}>\\s*([^<]*?)\\s*</(?:[a-z0-9]+:)?${name}>`, 'i').exec(xml)?.[1];

async function soap(svc, action, args = []) {
  const inner = args.map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join('');
  const body = `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${svc.type}">${inner}</u:${action}></s:Body></s:Envelope>\r\n`;
  const r = await httpText(svc.control, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${svc.type}#${action}"`, 'Content-Length': Buffer.byteLength(body) },
    body,
  });
  if (r.status !== 200) {
    const err = new Error(tag(r.text, 'errorDescription') || `HTTP ${r.status}`);
    err.code = Number(tag(r.text, 'errorCode') || 0);
    throw err;
  }
  return r.text;
}

/** Службы роутера, через которые можно открыть порт. */
async function wanServices(dev) {
  const r = await httpText(dev.location);
  if (r.status !== 200) return [];
  const base = tag(r.text, 'URLBase') || dev.location;
  return [...r.text.matchAll(/<service>([\s\S]*?)<\/service>/gi)]
    .map((m) => ({ type: tag(m[1], 'serviceType') || '', control: tag(m[1], 'controlURL') || '' }))
    .filter((s) => WAN.test(s.type) && s.control)
    .map((s) => ({ ...s, control: new URL(s.control, base).href, local: dev.local, device: dev.location }));
}

/**
 * Открывает на роутере порты (UDP и TCP) для этого компьютера.
 * Возвращает { ok, externalIp, why, close() } — close() закрывает порты обратно (при выходе).
 */
export async function openPorts(ports, label = 'Parta video') {
  let devices = [];
  try {
    devices = await discover();
  } catch {}
  if (!devices.length) return { ok: false, why: 'noupnp' };
  let lastWhy = 'noservice';
  for (const dev of devices) {
    let services = [];
    try {
      services = await wanServices(dev);
    } catch {
      continue;
    }
    for (const svc of services) {
      let externalIp = '';
      try {
        externalIp = tag(await soap(svc, 'GetExternalIPAddress'), 'NewExternalIPAddress') || '';
      } catch {}
      // У роутера бывает несколько подключений (например, PPPoE и запасное) — берём то, что с адресом
      if (!externalIp || externalIp === '0.0.0.0') continue;
      const done = [];
      let lease = 7200;
      let failed = '';
      for (const [proto, port] of ports) {
        const add = (l) =>
          soap(svc, 'AddPortMapping', [
            ['NewRemoteHost', ''],
            ['NewExternalPort', port],
            ['NewProtocol', proto],
            ['NewInternalPort', port],
            ['NewInternalClient', svc.local],
            ['NewEnabled', 1],
            ['NewPortMappingDescription', label],
            ['NewLeaseDuration', l],
          ]);
        try {
          await add(lease).catch(async (e) => {
            // 725 — роутер умеет только постоянные правила; 718 — правило уже есть (часто наше же, с прошлого запуска)
            if (e.code === 725 || (lease && /lease/i.test(e.message))) {
              lease = 0;
              return add(0);
            }
            if (e.code === 718) {
              await soap(svc, 'DeletePortMapping', [['NewRemoteHost', ''], ['NewExternalPort', port], ['NewProtocol', proto]]).catch(() => {});
              return add(lease);
            }
            throw e;
          });
          done.push([proto, port]);
        } catch (e) {
          failed = e.code === 718 ? 'conflict' : e.code === 606 || e.code === 401 || /author/i.test(e.message) ? 'denied' : 'error';
          break;
        }
      }
      if (failed) {
        lastWhy = failed;
        for (const [proto, port] of done)
          await soap(svc, 'DeletePortMapping', [['NewRemoteHost', ''], ['NewExternalPort', port], ['NewProtocol', proto]]).catch(() => {});
        continue;
      }
      const close = async () => {
        for (const [proto, port] of done)
          await soap(svc, 'DeletePortMapping', [['NewRemoteHost', ''], ['NewExternalPort', port], ['NewProtocol', proto]]).catch(() => {});
      };
      // Правило с ограниченным сроком надо продлевать, пока окно открыто
      let timer = null;
      if (lease) {
        timer = setInterval(() => openAgain(svc, done, label, lease), (lease / 3) * 1000);
        timer.unref?.();
      }
      return {
        ok: true,
        externalIp,
        local: svc.local,
        close: async () => {
          if (timer) clearInterval(timer);
          await close();
        },
      };
    }
  }
  return { ok: false, why: lastWhy };
}

async function openAgain(svc, done, label, lease) {
  for (const [proto, port] of done)
    await soap(svc, 'AddPortMapping', [
      ['NewRemoteHost', ''],
      ['NewExternalPort', port],
      ['NewProtocol', proto],
      ['NewInternalPort', port],
      ['NewInternalClient', svc.local],
      ['NewEnabled', 1],
      ['NewPortMappingDescription', label],
      ['NewLeaseDuration', lease],
    ]).catch(() => {});
}
