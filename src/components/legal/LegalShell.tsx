import Link from 'next/link';
import { Footer } from '@/components/landing/Footer';
import { Header } from '@/components/landing/Header';
import { getUser } from '@/lib/auth';
import { legal } from '@/lib/legal';

const DOCS = [
  ['/pricing', 'Тарифы'],
  ['/legal/offer', 'Оферта'],
  ['/legal/privacy', 'Политика конфиденциальности'],
  ['/legal/contacts', 'Контакты и реквизиты'],
] as const;

/** Публичные страницы с документами: шапка и подвал как на главной, слева — список документов. */
export async function LegalShell({ active, title, children }: { active: string; title: string; children: React.ReactNode }) {
  const user = await getUser().catch(() => null);
  const l = legal();
  return (
    <>
      <Header loggedIn={Boolean(user)} />
      <main className="wrap grid grid-cols-1 gap-8 py-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12 lg:py-14">
        <nav aria-label="Документы" className="flex flex-wrap gap-2 lg:sticky lg:top-24 lg:grid lg:content-start lg:self-start lg:gap-1">
          {DOCS.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={active === href ? 'page' : undefined}
              className={`rounded-xl px-3.5 py-2 text-[15px] transition-colors ${active === href ? 'bg-tint font-medium text-brand-800' : 'text-ink-2 hover:bg-mist hover:text-ink'}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <article className="min-w-0">
          <h1 className="text-[32px] leading-tight font-medium tracking-[-0.01em] sm:text-[40px]">{title}</h1>
          {!l.filled && active !== '/pricing' && (
            <p className="mt-4 rounded-2xl bg-[#fff4cc] px-4 py-3 text-[14px] text-ink">
              Реквизиты исполнителя скоро появятся на этой странице.
            </p>
          )}
          <div className="legal mt-6">{children}</div>
        </article>
      </main>
      <Footer />
    </>
  );
}
