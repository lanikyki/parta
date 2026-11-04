'use client';

import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';

const CARDS = [
  ['4242', 'Карта •••• 4242', 'оплата пройдёт'],
  ['1111', 'Карта •••• 1111', 'другая карта, оплата пройдёт'],
  ['0000', 'Карта •••• 0000', 'оплата пройдёт, автопродление — нет'],
  ['fail', 'Карта •••• 9999', 'банк откажет: мало денег'],
] as const;

export function TestPayForm({ id, ret, saveCard }: { id: string; ret: string; saveCard: boolean }) {
  const [card, setCard] = useState<string>('4242');
  const [busy, setBusy] = useState<'' | 'pay' | 'cancel'>('');
  const [error, setError] = useState('');

  async function send(action: 'pay' | 'cancel') {
    setBusy(action);
    setError('');
    try {
      const res = await fetch('/api/billing/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action, card }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Не получилось');
      window.location.href = ret;
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  }

  return (
    <div className="mt-5 grid gap-2">
      {CARDS.map(([v, title, hint]) => (
        <label key={v} className={`flex cursor-pointer items-center gap-3 rounded-xl border-[1.5px] px-4 py-3 ${card === v ? 'border-brand bg-tint/50' : 'border-line-2'}`}>
          <input type="radio" name="card" value={v} checked={card === v} onChange={() => setCard(v)} className="h-4 w-4 accent-[var(--color-brand)]" />
          <span className="min-w-0">
            <b className="block font-mono text-[15px] font-medium">{title}</b>
            <span className="block text-[13px] text-ink-3">{hint}</span>
          </span>
        </label>
      ))}
      {saveCard && <p className="text-[13px] text-ink-3">Карта сохранится для автопродления.</p>}
      {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger-600">{error}</p>}
      <button type="button" className="btn btn-primary mt-3" onClick={() => send('pay')} disabled={Boolean(busy)}>
        {busy === 'pay' && <LoaderCircle size={18} className="animate-spin" />} Оплатить
      </button>
      <button type="button" className="btn btn-line" onClick={() => send('cancel')} disabled={Boolean(busy)}>
        {busy === 'cancel' && <LoaderCircle size={18} className="animate-spin" />} Отменить и вернуться
      </button>
    </div>
  );
}
