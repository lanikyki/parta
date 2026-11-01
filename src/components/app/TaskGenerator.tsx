'use client';

import { Check, Copy, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { GRADES, gradeLabel } from '@/lib/brand';
import { renderMarkdown } from '@/lib/mathtext';
import { formatSec, useElapsed } from './useElapsed';

export function TaskGenerator() {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const sec = useElapsed(busy);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setText('');
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch('/api/ai/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...f, count: Number(f.count) }),
      });
      // Сервер, пока ИИ думает, шлёт пробелы — поэтому ошибка приходит в поле error даже при коде 200
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error || !out.text) throw new Error(out.error || 'ИИ не ответил, попробуйте ещё раз');
      setText(String(out.text));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-6">
      <h2 className="flex items-center gap-2 text-lg font-medium">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent-600">
          <ListChecks size={18} />
        </span>
        Задачи от ИИ
      </h2>
      <p className="mt-2 text-[15px] text-ink-2">Подборка задач по теме — для урока или домашнего задания.</p>
      <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 gap-3">
        <input className="input" name="topic" required maxLength={200} placeholder="Тема, например: теорема Виета" />
        <div className="grid grid-cols-3 gap-2">
          <select className="input pr-8 pl-3" name="grade" defaultValue="9" aria-label="Класс">
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {/^\d+$/.test(g) ? `${g} кл.` : gradeLabel(g)}
              </option>
            ))}
          </select>
          <select className="input pr-8 pl-3" name="level" defaultValue="средний" aria-label="Уровень">
            <option value="база">База</option>
            <option value="средний">Средний</option>
            <option value="сложный">Сложный</option>
          </select>
          <select className="input pr-8 pl-3" name="count" defaultValue="5" aria-label="Количество">
            {[3, 5, 7, 10].map((n) => (
              <option key={n} value={n}>
                {n} шт.
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-soft" disabled={busy}>
          {busy ? `Составляю задачи…${sec >= 3 ? ` ${formatSec(sec)}` : ''}` : 'Составить'}
        </button>
        {busy && sec >= 15 && <p className="text-[13px] text-ink-3">ИИ подбирает задачи — обычно это занимает до минуты.</p>}
      </form>
      {error && <p className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger-600">{error}</p>}
      {text && (
        <div className="mt-4 rounded-2xl bg-mist p-4">
          <div className="prose-chat text-[15px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
          <button
            type="button"
            className="btn btn-line btn-sm mt-3"
            onClick={async () => {
              await navigator.clipboard.writeText(text).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
      )}
    </section>
  );
}
