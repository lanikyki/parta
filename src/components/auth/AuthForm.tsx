'use client';

import { ArrowLeft, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { WaitHint, useHydrated } from '@/components/useHydrated';
import { GRADES, gradeLabel } from '@/lib/brand';
import { safeNext } from '@/lib/nav';

type CodeInfo = { email: string; wait?: number; devCode?: string; mail?: boolean; mailError?: string; already?: boolean };

async function post<T = Record<string, unknown>>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || 'Что-то пошло не так, попробуйте ещё раз'), { gone: Boolean(out.gone) });
  return out as T;
}

function useNext() {
  const params = useSearchParams();
  const next = params.get('next');
  const safe = safeNext(next) ?? '/dashboard';
  // Код приглашения репетитора (/invite/…) — переносим между входом и регистрацией
  const invite = /^[a-z2-9]{8}$/.test(params.get('invite') || '') ? params.get('invite')! : '';
  const carry = new URLSearchParams();
  if (next) carry.set('next', next);
  if (invite) carry.set('invite', invite);
  return { next, safe, invite, q: carry.size ? `?${carry}` : '' };
}

function ErrorBox({ text }: { text: string }) {
  return text ? <p className="rounded-xl bg-danger-soft px-4 py-3 text-[15px] text-danger-600">{text}</p> : null;
}

/** Шаг с кодом из письма: поле для 6 цифр, «отправить ещё раз», подсказки. */
function CodeStep({
  info,
  purpose,
  onBack,
  onSubmit,
  children,
  submitLabel,
  autoSubmit,
}: {
  info: CodeInfo;
  purpose: 'register' | 'reset';
  onBack: () => void;
  onSubmit: (code: string) => Promise<void>;
  children?: React.ReactNode;
  submitLabel: string;
  autoSubmit?: boolean;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(info);
  const [left, setLeft] = useState(info.wait ?? 60);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (code.length !== 6) return setError('Введите 6 цифр из письма');
    setError('');
    setBusy(true);
    try {
      await onSubmit(code);
    } catch (err) {
      setError((err as Error).message);
      if ((err as { gone?: boolean }).gone) setLeft(0);
      setCode('');
      setBusy(false);
    }
  }

  async function resend() {
    setError('');
    try {
      const out = await post<CodeInfo>('/api/auth/resend', { email: state.email, purpose });
      setState({ ...out, email: state.email });
      setLeft(out.wait ?? 60);
      setCode('');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} method="post" className="grid grid-cols-1 gap-4">
      <div className="flex items-start gap-3 rounded-2xl bg-tint p-4 text-[15px] text-brand-800">
        <MailCheck size={22} className="mt-0.5 shrink-0" />
        {state.mailError ? (
          <p>
            Письмо с кодом на <b className="font-medium break-all">{state.email}</b> пока не отправилось.
          </p>
        ) : (
          <p>
            {state.already ? 'Мы уже отправили код на ' : 'Отправили код на '}
            <b className="font-medium break-all">{state.email}</b>. Введите 6 цифр из письма. Не видите письмо — загляните в папку «Спам».
          </p>
        )}
      </div>
      {state.mailError && (
        <p className="rounded-xl bg-[#fff4cc] px-4 py-3 text-[14px] text-ink">
          {state.mailError} Нажмите «Отправить код ещё раз» чуть позже — или попросите код у владельца сайта: он записан в окне сервера.
          {state.devCode && (
            <span className="mt-1 block">
              Код для проверки (виден только при запуске на своём компьютере): <b className="font-mono text-[15px]">{state.devCode}</b>
            </span>
          )}
        </p>
      )}
      {state.devCode && !state.mailError && (
        <p className="rounded-xl bg-[#fff4cc] px-4 py-3 text-[14px] text-ink">
          Почта на сайте ещё не настроена, поэтому письмо не отправлено. Код для проверки: <b className="font-mono text-[15px]">{state.devCode}</b>
          <span className="block text-ink-2">Его видно только при запуске на своём компьютере. Как включить письма — в README, раздел «Почта».</span>
        </p>
      )}
      {state.mail === false && !state.devCode && !state.mailError && (
        <p className="rounded-xl bg-[#fff4cc] px-4 py-3 text-[14px] text-ink">
          Почта на сайте ещё не настроена, письмо не отправлено. Код записан в окне сервера — его может посмотреть владелец сайта.
        </p>
      )}
      <label className="field">
        Код из письма
        <input
          className="input h-14 text-center font-mono text-[26px] tracking-[0.4em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          name="code"
          autoFocus
          required
          pattern="\d{6}"
          placeholder="••••••"
          value={code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6);
            setCode(v);
            if (autoSubmit && v.length === 6) setTimeout(() => formRef.current?.requestSubmit(), 0);
          }}
        />
      </label>
      {children}
      <ErrorBox text={error} />
      <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy}>
        {busy ? 'Проверяю…' : submitLabel}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 py-1.5 text-ink-2 hover:text-ink">
          <ArrowLeft size={16} /> Изменить email
        </button>
        {left > 0 ? (
          <span className="text-ink-3">Новый код — через {left} с</span>
        ) : (
          <button type="button" onClick={resend} className="py-1.5 font-medium text-brand-700 hover:underline">
            Отправить код ещё раз
          </button>
        )}
      </div>
    </form>
  );
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const params = useSearchParams();
  const { safe, q, invite } = useNext();
  const ready = useHydrated();
  const [role, setRole] = useState<'student' | 'tutor'>(params.get('role') === 'tutor' && !invite ? 'tutor' : 'student');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [codeInfo, setCodeInfo] = useState<CodeInfo | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const emailRef = useRef<HTMLInputElement>(null);

  const done = () => {
    router.replace(safe);
    router.refresh();
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const data: Record<string, string> = { ...(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>), role };
    if (invite) data.invite = invite;
    try {
      if (mode === 'login') {
        await post('/api/auth/login', data);
        return done();
      }
      const { password: _pw, ...rest } = data; // пароль в памяти формы не храним
      setSaved(rest);
      const out = await post<CodeInfo>('/api/auth/register', data);
      setCodeInfo({ ...out, email: out.email || data.email });
      setBusy(false);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (mode === 'register' && codeInfo)
    return (
      <CodeStep
        info={codeInfo}
        purpose="register"
        autoSubmit
        submitLabel="Подтвердить и войти"
        onBack={() => setCodeInfo(null)}
        onSubmit={async (code) => {
          await post('/api/auth/verify', { email: codeInfo.email, code });
          done();
        }}
      />
    );

  return (
    <form onSubmit={onSubmit} method="post" className="grid grid-cols-1 gap-4">
      {mode === 'register' && !invite && (
        <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-white p-1 shadow-[inset_0_0_0_1.5px_var(--color-line-2)]" role="radiogroup" aria-label="Кто вы">
          {(
            [
              ['student', 'Я ученик'],
              ['tutor', 'Я репетитор'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={role === value}
              onClick={() => setRole(value)}
              className={`h-11 rounded-[10px] text-[15px] font-medium transition-colors ${role === value ? 'bg-brand text-white' : 'text-ink-2 hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {mode === 'register' && (
        <label className="field">
          {role === 'tutor' ? 'Имя и отчество' : 'Имя'}
          <input
            className="input"
            name="name"
            required
            minLength={2}
            maxLength={60}
            autoComplete="name"
            defaultValue={saved.name}
            placeholder={role === 'tutor' ? 'Анна Сергеевна' : 'Миша'}
          />
        </label>
      )}
      <label className="field">
        Email
        <input ref={emailRef} className="input" name="email" type="email" suppressHydrationWarning required autoComplete="email" defaultValue={saved.email} placeholder="you@example.ru" />
      </label>
      <label className="field">
        <span className="flex items-center justify-between">
          Пароль
          {mode === 'login' && (
            <Link
              href="/reset"
              className="text-[14px] font-normal text-brand-700 hover:underline"
              onClick={(e) => {
                const v = emailRef.current?.value.trim();
                if (v) {
                  e.preventDefault();
                  router.push(`/reset?email=${encodeURIComponent(v)}`);
                }
              }}
            >
              Забыли пароль?
            </Link>
          )}
        </span>
        <input
          className="input"
          name="password"
          type="password"
          suppressHydrationWarning
          required
          minLength={mode === 'register' ? 8 : 1}
          maxLength={200}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          placeholder={mode === 'register' ? 'Не короче 8 символов' : ''}
        />
      </label>
      {mode === 'register' && role === 'student' && (
        <label className="field">
          Класс или уровень
          <select className="input" name="grade" defaultValue={saved.grade || ''}>
            <option value="">Не выбран</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {gradeLabel(g)}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode === 'register' && (
        <label className="flex items-start gap-2.5 text-[14px] leading-snug text-ink-2">
          <input
            type="checkbox"
            name="consent"
            value="1"
            required
            defaultChecked={saved.consent === '1'}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand)]"
          />
          <span>
            Даю{' '}
            <Link href="/legal/consent" target="_blank" className="underline hover:text-ink">
              согласие на обработку персональных данных
            </Link>
          </span>
        </label>
      )}
      <ErrorBox text={error} />
      <button type="submit" className="btn btn-primary btn-lg mt-2 w-full" disabled={busy || !ready}>
        {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Получить код на почту'}
      </button>
      <WaitHint show={!ready} />
      {mode === 'register' && (
        <p className="text-center text-[13px] leading-snug text-ink-3">
          Регистрируясь, вы принимаете{' '}
          <Link href="/legal/offer" target="_blank" className="underline hover:text-ink">
            условия оферты
          </Link>
          . Как мы храним данные, описано в{' '}
          <Link href="/legal/privacy" target="_blank" className="underline hover:text-ink">
            политике конфиденциальности
          </Link>
          .
        </p>
      )}
      <p className="text-center text-[15px] text-ink-2">
        {mode === 'login' ? (
          <>
            Нет аккаунта?{' '}
            <Link className="font-medium text-brand-700 hover:underline" href={`/register${q}`}>
              Зарегистрироваться
            </Link>
          </>
        ) : (
          <>
            Уже есть аккаунт?{' '}
            <Link className="font-medium text-brand-700 hover:underline" href={`/login${q}`}>
              Войти
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

/** Восстановление пароля: email → код из письма + новый пароль. */
export function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') || '');
  const ready = useHydrated();
  const [codeInfo, setCodeInfo] = useState<CodeInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  if (codeInfo)
    return (
      <CodeStep
        info={codeInfo}
        purpose="reset"
        submitLabel="Сохранить пароль и войти"
        onBack={() => setCodeInfo(null)}
        onSubmit={async (code) => {
          await post('/api/auth/reset/confirm', { email: codeInfo.email, code, password: pwRef.current?.value || '' });
          router.replace('/dashboard');
          router.refresh();
        }}
      >
        <label className="field">
          Новый пароль
          <input ref={pwRef} className="input" type="password" suppressHydrationWarning required minLength={8} maxLength={200} autoComplete="new-password" placeholder="Не короче 8 символов" />
        </label>
      </CodeStep>
    );

  return (
    <form
      className="grid grid-cols-1 gap-4"
      method="post"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
          const out = await post<CodeInfo>('/api/auth/reset', { email });
          setCodeInfo({ ...out, email: out.email || email });
        } catch (err) {
          setError((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <label className="field">
        Email аккаунта
        <input className="input" type="email" suppressHydrationWarning required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.ru" autoFocus />
      </label>
      <ErrorBox text={error} />
      <button type="submit" className="btn btn-primary btn-lg mt-2 w-full" disabled={busy || !ready}>
        {busy ? 'Подождите…' : 'Получить код на почту'}
      </button>
      <WaitHint show={!ready} />
      <p className="text-center text-[15px] text-ink-2">
        Вспомнили пароль?{' '}
        <Link className="font-medium text-brand-700 hover:underline" href="/login">
          Войти
        </Link>
      </p>
    </form>
  );
}
