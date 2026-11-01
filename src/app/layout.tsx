import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/onest';
import '@fontsource-variable/martian-mono';
import 'katex/dist/katex.min.css';
import './globals.css';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — ${BRAND.tagline.toLowerCase()}`, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = { themeColor: '#12a566', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
