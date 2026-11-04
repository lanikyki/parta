import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '@/components/legal/LegalShell';
import { BRAND } from '@/lib/brand';
import { legal } from '@/lib/legal';

export const metadata: Metadata = { title: 'Контакты и реквизиты' };

export default function ContactsPage() {
  const l = legal();
  const rows: [string, React.ReactNode][] = [
    ['Исполнитель', l.name],
    ['ИНН', l.inn || '—'],
    ['ОГРНИП', l.ogrnip || '—'],
    ...(l.address ? ([['Адрес', l.address]] as [string, React.ReactNode][]) : []),
    ['Почта', l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : '—'],
    ...(l.phone ? ([['Телефон', <a key="p" href={`tel:${l.phone.replace(/[^\d+]/g, '')}`}>{l.phone}</a>]] as [string, React.ReactNode][]) : []),
  ];
  return (
    <LegalShell active="/legal/contacts" title="Контакты и реквизиты">
      <p>
        Сервис «{BRAND.name}» — онлайн-класс для репетиторов. Быстрее всего ответим в <Link href="/messages?support=1">поддержке на сайте</Link> (нужно войти в аккаунт) или
        по почте.
      </p>
      <dl className="mt-6 grid max-w-[560px] grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-[20px] border border-line p-5 text-[16px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd className="text-ink [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6">
        Документы: <Link href="/legal/offer">публичная оферта</Link>, <Link href="/legal/privacy">политика конфиденциальности</Link>, <Link href="/pricing">тарифы</Link>.
      </p>
    </LegalShell>
  );
}
