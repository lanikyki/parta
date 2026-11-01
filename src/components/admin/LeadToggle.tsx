'use client';

import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Кнопка «Обработано» у обращения с сайта. */
export function LeadToggle({ id, done }: { id: string; done: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/admin/leads/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done: !done }) });
        router.refresh();
        setBusy(false);
      }}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition-colors ${
        done ? 'bg-tint text-brand-800 hover:bg-tint-2' : 'bg-white text-ink-2 shadow-[inset_0_0_0_1.5px_var(--color-line-2)] hover:text-ink'
      }`}
    >
      <Check size={16} /> {done ? 'Обработано' : 'Отметить обработанным'}
    </button>
  );
}
