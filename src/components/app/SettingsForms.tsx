'use client';

import { Check, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { DeviceCheck } from './DeviceCheck';

async function post(url: string, data: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'Не получилось сохранить, попробуйте ещё раз');
  return out;
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <span className="min-w-0">
        <b className="block font-medium">{label}</b>
        <span className="block text-[14px] text-ink-3">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${value ? 'bg-brand' : 'bg-line-2'}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow-soft transition-transform ${value ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

export function SettingsForms({ tutor, notifyMessages, notifyBilling }: { tutor: boolean; notifyMessages: boolean; notifyBilling: boolean }) {
  const [msgs, setMsgs] = useState(notifyMessages);
  const [bill, setBill] = useState(notifyBilling);
  const [note, setNote] = useState('');

  async function change(key: 'notifyMessages' | 'notifyBilling', v: boolean) {
    const set = key === 'notifyMessages' ? setMsgs : setBill;
    set(v);
    try {
      await post('/api/me/settings', { [key]: v });
      setNote('Сохранено');
      setTimeout(() => setNote(''), 1500);
    } catch (e) {
      set(!v);
      setNote((e as Error).message);
    }
  }

  return (
    <>
      <section className="card p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-medium">Письма на почту</h2>
          {note && <span className="text-[13px] text-ink-3">{note}</span>}
        </div>
        <div className="mt-1 divide-y divide-line">
          <Toggle label="Новые сообщения" hint="Если вас нет на сайте, пришлём письмо о первом непрочитанном сообщении." value={msgs} onChange={(v) => change('notifyMessages', v)} />
          {tutor && (
            <Toggle label="Подписка и бонусы" hint="Оплаты, продление, конец подписки и начисленные бонусы." value={bill} onChange={(v) => change('notifyBilling', v)} />
          )}
        </div>
        <p className="mt-2 text-[13px] text-ink-3">Письма для входа и восстановления пароля приходят всегда.</p>
      </section>

      <section id="devices" className="card scroll-mt-24 p-5 sm:p-6">
        <h2 className="mb-4 text-lg font-medium">Камера и микрофон</h2>
        <DeviceCheck />
      </section>

      <PasswordForm />
      <DeleteAccount />
    </>
  );
}

function PasswordForm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="card grid gap-4 p-5 sm:p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
        setError('');
        setDone(false);
        if (f.next !== f.repeat) return setError('Новые пароли не совпадают');
        setBusy(true);
        try {
          await post('/api/me/password', { current: f.current, next: f.next });
          setDone(true);
          form.reset();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-medium">Пароль</h2>
      <input type="text" name="username" autoComplete="username" className="hidden" aria-hidden tabIndex={-1} readOnly />
      <label className="field">
        <span>Текущий пароль</span>
        <input className="input" type="password" name="current" required autoComplete="current-password" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span>Новый пароль</span>
          <input className="input" type="password" name="next" required minLength={8} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>Ещё раз</span>
          <input className="input" type="password" name="repeat" required minLength={8} autoComplete="new-password" />
        </label>
      </div>
      <p className="-mt-1 text-[13px] text-ink-3">Не короче 8 символов. На других устройствах после смены нужно будет войти заново.</p>
      {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <LoaderCircle size={18} className="animate-spin" />} Сменить пароль
        </button>
        {done && (
          <span className="inline-flex items-center gap-1.5 text-[14px] text-mint">
            <Check size={16} /> Пароль изменён
          </span>
        )}
      </div>
    </form>
  );
}

function DeleteAccount() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <details className="group card p-5 sm:p-6">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <h2 className="text-lg font-medium">Удалить аккаунт</h2>
        <span className="text-[14px] text-ink-3 group-open:hidden">Показать</span>
      </summary>
      <form
        className="mt-3 grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          if (!confirm('Удалить аккаунт навсегда? Это нельзя отменить.')) return;
          setBusy(true);
          setError('');
          try {
            await post('/api/me/delete', { password: f.password });
            window.location.href = '/';
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <p className="text-[15px] text-ink-2">
          Удалятся уроки, доски, переписка и фото. Оплаченная подписка не возвращается автоматически — если нужен возврат, сначала напишите в поддержку.
        </p>
        <label className="field max-w-[360px]">
          <span>Пароль для подтверждения</span>
          <input className="input" type="password" name="password" required autoComplete="current-password" />
        </label>
        {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger-600">{error}</p>}
        <div>
          <button type="submit" className="btn btn-sm bg-danger text-white hover:bg-danger-600" disabled={busy}>
            {busy && <LoaderCircle size={16} className="animate-spin" />} Удалить навсегда
          </button>
        </div>
      </form>
    </details>
  );
}
