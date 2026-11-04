import Link from 'next/link';
import { PlanCards } from '@/components/PlanCards';
import { REF_DISCOUNT, REF_SHARE, TRIAL_MIN } from '@/lib/plans';
import { SectionHead } from './SectionHead';

export function Pricing({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section id="pricing" className="wrap py-20 sm:py-28">
      <SectionHead
        tag="Тарифы"
        title="Платит только репетитор"
        text={`Ученики занимаются бесплатно. Кабинет, переписка, доска и чат — тоже бесплатно, а первый урок с видео длится ${TRIAL_MIN} минут без оплаты. Видеоуроки и ИИ-функции — по подписке.`}
      />
      <div data-reveal className="mt-10">
        <PlanCards href={loggedIn ? '/billing' : '/register?role=tutor'} freeHref={loggedIn ? '/dashboard' : '/register?role=tutor'} />
      </div>
      <p data-reveal className="mt-6 text-center text-[15px] text-ink-2">
        Пригласите коллегу: ему — скидка {Math.round(REF_DISCOUNT * 100)}% на первую оплату, вам — {Math.round(REF_SHARE * 100)}% с его оплат бонусами.{' '}
        <Link href="/pricing" className="font-medium text-brand-700 hover:underline">
          Подробнее о тарифах
        </Link>
      </p>
    </section>
  );
}
