import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/onest';
import '@fontsource-variable/martian-mono';
import 'katex/dist/katex.min.css';
import './globals.css';
import { headers } from 'next/headers';
import { BRAND } from '@/lib/brand';
import { siteUrl } from '@/lib/http';
import { og } from '@/lib/og';

const TITLE = `${BRAND.name} — ${BRAND.tagline.toLowerCase()}`;

// Адрес сайта нужен для превью ссылок в мессенджерах (картинка и описание): берём тот же, что и для писем —
// домен сервера, ссылку туннеля или адрес, с которого открыли сайт.
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(siteUrl({ headers: await headers() } as Request)),
    title: { default: TITLE, template: `%s · ${BRAND.name}` },
    description: BRAND.description,
    icons: { icon: '/icon.svg' },
    openGraph: og(TITLE, BRAND.description),
    twitter: { card: 'summary_large_image' },
  };
}

export const viewport: Viewport = { themeColor: '#12a566', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
