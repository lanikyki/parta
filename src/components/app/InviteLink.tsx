'use client';

import { Check, Link2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Кнопка «Скопировать ссылку-приглашение» для репетитора. */
export function InviteLink({ code, className = '', label = 'Скопировать ссылку-приглашение' }: { code: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn-soft h-auto min-h-11 py-2.5 text-center leading-tight whitespace-normal ${className}`}
      onClick={async () => {
        const url = `${location.origin}/invite/${code}`;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          prompt('Скопируйте ссылку-приглашение', url);
        }
        setDone(true);
        setTimeout(() => setDone(false), 2200);
      }}
    >
      {done ? <Check size={17} className="shrink-0" /> : <Link2 size={17} className="shrink-0" />}
      {done ? 'Ссылка скопирована — отправьте её ученику' : label}
    </button>
  );
}

/** Ученик уже вошёл в аккаунт: одна кнопка, чтобы принять приглашение репетитора. */
export function AcceptInvite({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="grid gap-3">
      <button
        type="button"
        className="btn btn-primary btn-lg w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const res = await fetch('/api/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
            const out = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(out.error || 'Не получилось, попробуйте ещё раз');
            router.push(`/messages?with=${out.tutor.id}`);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Подождите…' : 'Принять приглашение'}
      </button>
      {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-[15px] text-danger-600">{error}</p>}
    </div>
  );
}
