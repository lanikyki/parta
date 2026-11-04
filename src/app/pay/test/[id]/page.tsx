import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { TestPayForm } from '@/components/app/TestPayForm';
import { getUser } from '@/lib/auth';
import { type PaymentRow, paymentTitle } from '@/lib/billing';
import { one } from '@/lib/db';
import { paymentsTestMode } from '@/lib/payments';
import { rub } from '@/lib/plans';

export const metadata: Metadata = { title: 'Тестовая оплата', robots: { index: false } };

export default async function TestPayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ return?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!paymentsTestMode()) notFound();
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/pay/test/${id}`)}`);
  const p = /^[0-9a-f-]{36}$/.test(id) ? await one<PaymentRow>("select * from payments where id = $1 and user_id = $2 and provider = 'test'", [id, user.id]) : null;
  if (!p) notFound();
  const ret = typeof sp.return === 'string' && /^\/billing\?paid=[0-9a-f-]{36}(&back=[\w%/-]+)?$/.test(sp.return) ? sp.return : `/billing?paid=${id}`;
  if (p.status !== 'pending') redirect(ret);
  return (
    <div className="grid min-h-dvh place-items-center bg-mist px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="card p-6 shadow-soft">
          <p className="tag text-accent-600">Тестовая касса</p>
          <h1 className="mt-2 text-[22px] leading-tight font-medium">{paymentTitle(p)}</h1>
          <p className="mt-3 text-[36px] leading-none font-medium tracking-tight">{rub(p.amount_kop)}</p>
          <p className="mt-3 text-[14px] text-ink-3">
            Это проверочная страница: деньги не списываются. Когда подключите ЮKassa, здесь будет её настоящая страница оплаты.
          </p>
          <TestPayForm id={p.id} ret={ret} saveCard={p.save_card} />
        </div>
      </div>
    </div>
  );
}
