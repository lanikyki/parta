'use client';

import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { WaitHint, useHydrated } from '@/components/useHydrated';

/** Короткая форма «Задать вопрос»: попадает в админку → «Обращения». */
export function LeadForm() {
  const ready = useHydrated();
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setState('sending');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Не получилось отправить вопрос');
      setState('done');
    } catch (err) {
      setError((err as Error).message === 'Failed to fetch' ? 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.' : (err as Error).message);
      setState('idle');
    }
  }

  if (state === 'done')
    return (
      <div className="grid h-full min-h-[360px] place-items-center rounded-[24px] bg-white p-8 text-center text-ink">
        <div>
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-mint-soft text-mint">
            <CircleCheck size={32} />
          </span>
          <h3 className="mt-5 text-2xl font-medium">Вопрос отправлен</h3>
          <p className="mx-auto mt-2 max-w-[320px] text-ink-2">Спасибо! Ответим по контакту, который вы оставили.</p>
        </div>
      </div>
    );

  return (
    <form method="post" onSubmit={onSubmit} className="grid grid-cols-1 gap-4 rounded-[24px] bg-white p-5 text-ink sm:p-8">
      <div>
        <h3 className="text-2xl font-medium">Остались вопросы?</h3>
        <p className="mt-1 text-ink-2">Напишите — ответим на почту или в Telegram.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <label className="field">
          Как вас зовут
          <input className="input" name="name" required minLength={2} maxLength={60} autoComplete="name" placeholder="Имя" />
        </label>
        <label className="field">
          Как с вами связаться
          <input className="input" name="contact" required minLength={5} maxLength={80} placeholder="Почта или Telegram" />
        </label>
      </div>
      <label className="field">
        Ваш вопрос
        <textarea
          className="input"
          name="comment"
          rows={3}
          required
          minLength={3}
          maxLength={1000}
          placeholder="Например: подойдёт ли сервис для уроков музыки?"
        />
      </label>
      <label className="flex items-start gap-2.5 text-[14px] leading-snug text-ink-2">
        <input type="checkbox" name="consent" value="1" required className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand)]" />
        <span>
          Даю{' '}
          <Link href="/legal/consent" target="_blank" className="underline hover:text-ink">
            согласие на обработку персональных данных
          </Link>
        </span>
      </label>
      {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-[15px] text-danger-600">{error}</p>}
      <button type="submit" className="btn btn-primary btn-lg w-full" disabled={!ready || state === 'sending'}>
        {state === 'sending' ? 'Отправляем…' : 'Отправить вопрос'}
      </button>
      <WaitHint show={!ready} />
    </form>
  );
}
