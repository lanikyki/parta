// «Входная дверь» сайта в режиме показа другу (share-windows.bat).
// Один адрес на всё: страницы и API идут в Next.js, а подключение к видео (/rtc) — в видеосервер
// LiveKit на этом же компьютере. Так видео работает через ту же ссылку Tuna, что и сайт, —
// без LiveKit Cloud и без VPN.
import http from 'node:http';
import net from 'node:net';

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const isRtc = (url = '') => /^\/rtc(?:[/?]|$)/.test(url);
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
// Заголовки «одного звена»: они про соединение с нами, а не про сам запрос — дальше их не передаём
const HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade'];
const withoutHop = (h) => {
  const out = { ...h };
  for (const k of HOP) delete out[k];
  return out;
};

/**
 * Заголовки для сайта. Запросы через туннель приходят с этого же компьютера (программа tuna, cloudflared):
 * их заголовки X-Forwarded-* оставляем как есть — в них настоящий адрес друга. Прямым запросам
 * из домашней сети подделать адрес не даём: ставим тот, с которого запрос пришёл.
 */
function forwardHeaders(req) {
  const headers = { ...req.headers };
  const from = req.socket.remoteAddress || '';
  if (!LOOPBACK.test(from)) {
    headers['x-forwarded-for'] = from.replace(/^::ffff:/, '');
    delete headers['x-forwarded-host'];
    delete headers['x-forwarded-proto'];
    delete headers['x-real-ip'];
  }
  return headers;
}

function rawRequest(req, headers) {
  const lines = [`${req.method} ${req.url} HTTP/1.1`];
  for (const [k, v] of Object.entries(headers)) for (const one of Array.isArray(v) ? v : [v]) if (one !== undefined) lines.push(`${k}: ${one}`);
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/**
 * Запускает «дверь» на port. site и video — { host, port } (video может быть null: видео в облаке).
 * Возвращает сервер; ошибки прослушивания (порт занят) — через onError.
 */
export function startGateway({ port, host = '0.0.0.0', site, video, onError }) {
  const target = (url) => (video && isRtc(url) ? video : site);
  const server = http.createServer((req, res) => {
    const to = target(req.url);
    const up = http.request({ host: to.host, port: to.port, method: req.method, path: req.url, headers: withoutHop(forwardHeaders(req)), agent }, (r) => {
      res.writeHead(r.statusCode || 502, r.statusMessage, withoutHop(r.headers));
      r.pipe(res);
      r.on('error', () => res.destroy());
    });
    up.on('error', () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(to === site ? 'Сайт перезапускается — обновите страницу через несколько секунд.' : 'Видеосервер не отвечает.');
    });
    req.pipe(up);
    // друг закрыл страницу — не держим соединение с сайтом
    res.on('close', () => {
      if (!res.writableFinished) up.destroy();
    });
  });
  // WebSocket: подключение к видео и служебные соединения сайта
  server.on('upgrade', (req, socket, head) => {
    const to = target(req.url);
    const up = net.connect(to.port, to.host, () => {
      up.write(rawRequest(req, forwardHeaders(req)));
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.setNoDelay(true);
    socket.setNoDelay?.(true);
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
    up.on('close', () => socket.destroy());
    socket.on('close', () => up.destroy());
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.requestTimeout = 0; // ответы ИИ и долгие запросы не обрываем
  server.on('error', (e) => onError?.(e));
  server.listen(port, host);
  return server;
}
