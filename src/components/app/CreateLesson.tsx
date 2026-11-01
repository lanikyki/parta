'use client';

import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SUBJECTS } from '@/lib/brand';

export function CreateLesson() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('');
  // Предмет прошлого урока — чтобы не вписывать каждый раз
  useEffect(() => {
    if (open) setSubject(localStorage.getItem('parta-subject') || '');
  }, [open]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const f = Object.fromEntries(new FormData(e.currentTarget, submitter)) as Record<string, string>;
    const startsAt = f.startsAt ? new Date(f.startsAt).toISOString() : null;
    localStorage.setItem('parta-subject', (f.subject || '').trim());
    try {
      const res = await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...f, startsAt, durationMin: Number(f.durationMin) }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Не удалось создать урок');
      if (f.now === '1') router.push(`/lesson/${out.code}`);
      else {
        setOpen(false);
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary">
        <Plus size={18} /> Новый урок
      </button>
    );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={() => setOpen(false)}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="grid max-h-full w-full max-w-[520px] grid-cols-1 gap-4 overflow-auto rounded-[24px] bg-white p-6 shadow-lift sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-medium">Новый урок</h2>
          <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-mist" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <label className="field">
          Тема урока
          <input className="input" name="title" required maxLength={120} placeholder="Квадратные уравнения" autoFocus />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="field">
            Предмет
            <input
              className="input"
              name="subject"
              list="subjects"
              maxLength={40}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Например, английский"
              autoComplete="off"
            />
            <datalist id="subjects">
              {SUBJECTS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="field">
            Формат
            <select className="input" name="kind" defaultValue="individual">
              <option value="individual">Индивидуальный</option>
              <option value="group">Групповой (до 20)</option>
            </select>
          </label>
          <label className="field">
            Дата и время
            <input className="input" type="datetime-local" name="startsAt" />
          </label>
          <label className="field">
            Длительность
            <select className="input" name="durationMin" defaultValue="60">
              {[30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} минут
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-[15px] text-danger-600">{error}</p>}
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="submit" name="now" value="0" className="btn btn-line" disabled={busy}>
            Запланировать
          </button>
          <button type="submit" name="now" value="1" className="btn btn-primary" disabled={busy}>
            Начать сейчас
          </button>
        </div>
      </form>
    </div>
  );
}
