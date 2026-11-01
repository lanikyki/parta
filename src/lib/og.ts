import type { Metadata } from 'next';
import { BRAND } from './brand';

/**
 * Превью ссылки в мессенджерах (Telegram, WhatsApp, ВКонтакте): заголовок, описание и картинка public/og.png.
 * Страница со своим заголовком превью должна передавать всё целиком — Next.js не дополняет его данными сайта.
 */
export function og(title: string, description: string): NonNullable<Metadata['openGraph']> {
  return {
    type: 'website',
    locale: 'ru_RU',
    siteName: BRAND.name,
    title,
    description,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: `${BRAND.name} — видеоурок, общая доска и переписка с учениками` }],
  };
}
