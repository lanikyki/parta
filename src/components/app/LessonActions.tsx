'use client';

import { Check, Copy, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CopyLink({ code, className = '' }: { code: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Скопировать ссылку на урок"
      className={`btn btn-line btn-sm ${className}`}
      onClick={async () => {
        const url = `${location.origin}/lesson/${code}`;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          prompt('Скопируйте ссылку на урок', url);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? <Check size={16} /> : <Copy size={16} />}
      <span className="max-[359px]:sr-only">{done ? 'Скопировано' : 'Ссылка'}</span>
    </button>
  );
}

export function DeleteLesson({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="grid h-10 w-10 place-items-center rounded-[10px] text-ink-3 hover:bg-danger-soft hover:text-danger-600"
      aria-label="Удалить урок"
      title="Удалить урок"
      disabled={busy}
      onClick={async () => {
        if (!confirm('Удалить урок вместе с доской и чатом?')) return;
        setBusy(true);
        await fetch(`/api/lessons/${code}`, { method: 'DELETE' });
        router.refresh();
      }}
    >
      <Trash2 size={18} />
    </button>
  );
}

export function JoinByCode() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  return (
    <div>
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        const m = value.toLowerCase().match(/[a-z2-9]{3}-[a-z2-9]{3}-[a-z2-9]{3}/);
        if (!m) return setError('Вставьте ссылку от репетитора или код вида abc-def-ghk');
        router.push(`/lesson/${m[0]}`);
      }}
    >
      <input
        className="input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError('');
        }}
        placeholder="Ссылка или код урока"
        aria-label="Ссылка или код урока"
      />
      <button type="submit" className="btn btn-primary shrink-0">
        Войти в урок
      </button>
    </form>
      {error && <p className="mt-2 text-[14px] text-danger-600">{error}</p>}
    </div>
  );
}
