import { Gift } from 'lucide-react';
import Link from 'next/link';
import { REF_DISCOUNT } from '@/lib/plans';

/** Человек пришёл по приглашению коллеги — напоминаем про скидку на первую оплату. */
export function RefBanner({ name }: { name: string }) {
  return (
    <div className="wrap pt-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-[#fff4cc] px-4 py-3 sm:px-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sun text-ink">
          <Gift size={18} />
        </span>
        <p className="min-w-0 flex-1 text-[15px] text-ink">
          Вас пригласил(а) <b className="font-medium">{name}</b>. Зарегистрируйтесь как репетитор — первая оплата тарифа будет со скидкой {Math.round(REF_DISCOUNT * 100)}%.
        </p>
        <Link href="/register?role=tutor" className="btn btn-primary btn-sm max-sm:w-full">
          Зарегистрироваться
        </Link>
      </div>
    </div>
  );
}
