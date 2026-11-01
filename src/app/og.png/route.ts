import { OG_PNG_BASE64 } from '@/lib/og-image';

const png = Buffer.from(OG_PNG_BASE64, 'base64');

/** Картинка превью для мессенджеров (Telegram, WhatsApp, ВКонтакте). */
export function GET() {
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' },
  });
}
