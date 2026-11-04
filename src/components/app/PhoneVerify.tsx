'use client';

import { LoaderCircle, PhoneCall } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Out = { error?: string; wait?: number; devCode?: string; phone?: string; gone?: boolean };

async function post(data: unknown): Promise<{ ok: boolean; out: Out }> {
  try {
    const res = await fetch('/api/me/phone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    return { ok: res.ok, out: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, out: { error: 'Нет связи с сайтом, попробуйте ещё раз' } };
  }
}

/**
 * Подтверждение номера звонком: сайт звонит, человек вводит 4 последние цифры номера, с которого позвонили.
 * Отвечать на звонок не нужно, он бесплатный.
 */
export function PhoneVerify({ onDone, compact = false }: { onDone: (phone: string) => void; compact?: boolean }) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [shown, setShown] = useState('');
  const [code, setCode] = useState('');
  const [dev, setDev] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function call() {
    setBusy(true);
    setError('');
    const { ok, out } = await post({ action: 'call', phone });
    setBusy(false);
    if (out.wait) setWait(out.wait);
    if (!ok) return setError(out.error || 'Не получилось позвонить, попробуйте ещё раз');
    setShown(out.phone || phone);
    setDev(out.devCode || '');
    setCode('');
    setStep('code');
    setTimeout(() => codeRef.current?.focus(), 50);
  }

  async function check(value = code) {
    if (value.length !== 4 || busy) return;
    setBusy(true);
    setError('');
    const { ok, out } = await post({ action: 'check', code: value });
    setBusy(false);
    if (ok) return onDone(out.phone || shown);
    setError(out.error || 'Код не подошёл');
    if (out.gone) setStep('phone');
  }

  return (
    <div className={compact ? '' : 'max-w-[440px]'}>
      {step === 'phone' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            call();
          }}
          className="grid gap-3"
        >
          <label className="field">
            <span>Номер мобильного</span>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 900 123-45-67"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || wait > 0 || phone.replace(/\D/g, '').length < 10}>
            {busy ? <LoaderCircle size={18} className="animate-spin" /> : <PhoneCall size={18} />}
            {wait > 0 ? `Позвонить через ${wait} с` : 'Получить звонок'}
          </button>
          <p className="text-[13px] text-ink-3">Позвоним со случайного номера — отвечать не нужно, звонок бесплатный.</p>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
          className="grid gap-3"
        >
          <p className="text-[15px] text-ink-2">
            Звоним на <b className="font-medium whitespace-nowrap text-ink">{shown}</b>. Введите 4 последние цифры номера, с которого пришёл звонок.
          </p>
          {dev && (
            <p className="rounded-xl bg-[#fff4cc] px-3.5 py-2.5 text-[14px] text-ink">
              Тестовый режим: звонка не будет. Код — <b className="font-mono">{dev}</b>
            </p>
          )}
          <label className="field">
            <span>Последние 4 цифры</span>
            <input
              ref={codeRef}
              className="input font-mono text-[20px] tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              required
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                setCode(v);
                if (v.length === 4) check(v);
              }}
              placeholder="0000"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 4}>
            {busy && <LoaderCircle size={18} className="animate-spin" />} Подтвердить
          </button>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
            <button type="button" className="text-brand-700 hover:underline disabled:text-ink-3 disabled:no-underline" disabled={wait > 0 || busy} onClick={call}>
              {wait > 0 ? `Позвонить ещё раз через ${wait} с` : 'Позвонить ещё раз'}
            </button>
            <button
              type="button"
              className="text-ink-2 hover:text-ink"
              onClick={() => {
                setStep('phone');
                setError('');
              }}
            >
              Другой номер
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger-600">{error}</p>}
    </div>
  );
}
