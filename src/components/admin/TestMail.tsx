'use client';

import { Send } from 'lucide-react';
import { useState } from 'react';

/** Кнопка «Отправить тестовое письмо» — проверить, что почта настроена. */
export function TestMail() {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-4 grid gap-2 border-t border-line pt-4">
      <button
        type="button"
        className="btn btn-line btn-sm w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setState(null);
          try {
            const res = await fetch('/api/admin/test-mail', { method: 'POST' });
            const out = await res.json().catch(() => ({}));
            setState(res.ok ? { ok: true, text: `Письмо отправлено на ${out.to}. Проверьте ящик (и папку «Спам»).` } : { ok: false, text: out.error || 'Не получилось' });
          } catch {
            setState({ ok: false, text: 'Нет связи с сайтом' });
          }
          setBusy(false);
        }}
      >
        <Send size={16} /> {busy ? 'Отправляю…' : 'Отправить тестовое письмо себе'}
      </button>
      {state && <p className={`rounded-xl px-3 py-2 text-[14px] ${state.ok ? 'bg-tint text-brand-800' : 'bg-danger-soft text-danger-600'}`}>{state.text}</p>}
    </div>
  );
}
