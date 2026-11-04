'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PLANS, PLAN_IDS, rub } from '@/lib/plans';

async function send(data: Record<string, unknown>) {
  try {
    const res = await fetch('/api/admin/billing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const out = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
    return res.ok ? { ok: true as const, status: out.status } : { ok: false as const, error: out.error || 'Не получилось' };
  } catch {
    return { ok: false as const, error: 'Нет связи с сайтом' };
  }
}

/** «12,50» → 1250 копеек */
const toKop = (v: string) => Math.round(Number(v.replace(/\s/g, '').replace(',', '.')) * 100);

function useForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(data: Record<string, unknown>, done: string, form: HTMLFormElement) {
    setBusy(true);
    setMsg(null);
    const r = await send(data);
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error });
    if (r.ok) {
      form.reset();
      router.refresh();
    }
  }
  return { busy, msg, run };
}

function Note({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p className={`rounded-xl px-3.5 py-2.5 text-[14px] ${msg.ok ? 'bg-tint text-brand-800' : 'bg-danger-soft text-danger-600'}`}>{msg.text}</p>;
}

/** Выдать тариф без оплаты и начислить (или списать) бонусы. */
export function BillingForms() {
  const grant = useForm();
  const bonus = useForm();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <form
        className="card grid content-start gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          grant.run({ action: 'grant', email: f.email, plan: f.plan, days: Number(f.days), note: f.note }, 'Тариф выдан, репетитору ушло письмо.', e.currentTarget);
        }}
      >
        <h2 className="text-lg font-medium">Выдать тариф</h2>
        <p className="-mt-1 text-[14px] text-ink-2">Без оплаты: например, в подарок или вместо возврата. Дни добавятся к текущему тарифу.</p>
        <label className="field">
          Почта репетитора
          <input className="input" name="email" type="email" required placeholder="tutor@example.com" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            Тариф
            <select className="input" name="plan" defaultValue="pro">
              {PLAN_IDS.map((p) => (
                <option key={p} value={p}>
                  «{PLANS[p].name}»
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Дней
            <input className="input" name="days" type="number" min={1} max={3660} required defaultValue={30} />
          </label>
        </div>
        <label className="field">
          Комментарий
          <input className="input" name="note" maxLength={200} placeholder="Необязательно" />
        </label>
        <Note msg={grant.msg} />
        <button type="submit" className="btn btn-primary" disabled={grant.busy}>
          Выдать тариф
        </button>
      </form>
      <form
        className="card grid content-start gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          bonus.run({ action: 'bonus', email: f.email, amount: toKop(f.amount), note: f.note }, 'Готово: баланс обновлён.', e.currentTarget);
        }}
      >
        <h2 className="text-lg font-medium">Начислить бонусы</h2>
        <p className="-mt-1 text-[14px] text-ink-2">Бонусами репетитор оплачивает подписку. Со знаком минус — списать.</p>
        <label className="field">
          Почта репетитора
          <input className="input" name="email" type="email" required placeholder="tutor@example.com" />
        </label>
        <label className="field">
          Сумма, ₽
          <input className="input" name="amount" required inputMode="decimal" pattern="-?[0-9 ]+([.,][0-9]{1,2})?" placeholder="300" />
        </label>
        <label className="field">
          Комментарий
          <input className="input" name="note" maxLength={200} placeholder="Необязательно" />
        </label>
        <Note msg={bonus.msg} />
        <button type="submit" className="btn btn-primary" disabled={bonus.busy}>
          Начислить
        </button>
      </form>
    </div>
  );
}

/** Вернуть деньги за оплату (полностью или частично). Дни тарифа убавятся пропорционально. */
export function RefundButton({ id, left, suggest }: { id: string; left: number; suggest: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="btn btn-line btn-sm text-danger-600 disabled:opacity-50"
      onClick={async () => {
        const v = window.prompt(
          `Сколько вернуть, ₽? Можно до ${rub(left)}. За неиспользованные дни — примерно ${rub(suggest)}. Дни тарифа убавятся пропорционально сумме.`,
          (suggest / 100).toFixed(2).replace('.', ','),
        );
        if (v === null) return;
        const kop = toKop(v);
        if (!Number.isFinite(kop) || kop <= 0 || kop > left) return window.alert(`Сумма должна быть больше нуля и не больше ${rub(left)}`);
        setBusy(true);
        const r = await send({ action: 'refund', id, amount: kop });
        setBusy(false);
        if (!r.ok) return window.alert(r.error);
        if (r.status !== 'succeeded') window.alert('Касса приняла возврат. Деньги вернутся на карту в течение нескольких дней — дни тарифа убавятся, когда касса подтвердит возврат.');
        router.refresh();
      }}
    >
      Вернуть
    </button>
  );
}
