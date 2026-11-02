import os from 'node:os';
import type { NextConfig } from 'next';

// Адреса этого компьютера в домашней сети (например, 192.168.1.20) — чтобы сайт в режиме разработки
// нормально открывался с телефона или другого компьютера: без этого Next.js блокирует обновление страницы.
const lanAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => a!.address);

// Заголовки безопасности для всех страниц: сайт нельзя встроить в чужой сайт (защита от «кликджекинга»),
// браузер не угадывает тип файлов, камера/микрофон/показ экрана разрешены только самому сайту.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), geolocation=(), payment=(), usb=()' },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'nodemailer'],
  poweredByHeader: false,
  devIndicators: false,
  // Режим разработки открывается по ссылке туннеля (Tuna, Cloudflare и др.) и по адресу в домашней сети
  allowedDevOrigins: [
    '*.trycloudflare.com',
    '*.ru.tuna.am',
    '*.nl.tuna.am',
    '*.tuna.free',
    '*.a.tuna.free',
    '*.tunnelmole.net',
    '*.a.free.pinggy.link',
    '*.local',
    '192.168.*.*',
    '10.*.*.*',
    '172.*.*.*',
    ...lanAddresses,
  ],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Загруженные картинки: даже если открыть файл напрямую, никакой код из него не выполнится
      { source: '/api/assets/:id', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'self'; sandbox" }] },
      { source: '/api/messages/files/:id', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'self'; sandbox" }] },
    ];
  },
};

export default nextConfig;
