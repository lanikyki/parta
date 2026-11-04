'use client';

import { ArrowUp, BookOpen, Calculator, FlaskConical, Languages, LoaderCircle, RefreshCw, RotateCcw, Sparkles, Square, Target } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GRADES, SUBJECTS, gradeLabel } from '@/lib/brand';
import { renderMarkdown } from '@/lib/mathtext';
import { formatSec, useElapsed } from './useElapsed';

type Msg = { role: 'user' | 'assistant'; content: string };
const STORE = 'parta-assistant';
// Служебные знаки в потоке ответа: «пульс» (держит связь, пока ИИ думает) и начало сообщения об ошибке
const BEAT = /\u200b/g;
const MARK = '\u001e';

const STARTERS = [
  { icon: Calculator, subject: 'Алгебра', text: 'Объясни, как решать квадратные уравнения через дискриминант' },
  { icon: Target, subject: 'Математика', text: 'Проверь решение: 3x + 5 = 20, значит x = 6' },
  { icon: BookOpen, subject: 'Русский язык', text: 'Когда «не» с глаголами пишется слитно?' },
  { icon: Languages, subject: 'Английский язык', text: 'Чем Present Perfect отличается от Past Simple?' },
  { icon: FlaskConical, subject: 'Физика', text: 'Почему лёд плавает в воде? Объясни простыми словами' },
  { icon: Sparkles, subject: 'Программирование', text: 'Составь план изучения Python с нуля на месяц' },
];

/** «Думаю… 12 с» и подсказка, если сервис ИИ отвечает медленно. */
function Thinking({ smart }: { smart?: boolean }) {
  const sec = useElapsed(true);
  return (
    <div className="text-[15px] text-ink-3">
      <span className="inline-flex items-center gap-2">
        <LoaderCircle size={16} className="animate-spin" /> Думаю…{sec >= 3 ? ` ${formatSec(sec)}` : ''}
      </span>
      {sec >= 15 && (
        <p className="mt-1.5 text-[14px]">
          {sec >= 75
            ? 'Что-то долго. Можно подождать ещё или нажать ■ и спросить снова.'
            : smart
              ? 'Подробный ответ готовится дольше — обычно до минуты. Для коротких подсказок есть режим «Быстро».'
              : 'Сервис ИИ сейчас отвечает медленно — ответ уже готовится, подождите ещё немного.'}
        </p>
      )}
    </div>
  );
}

function Bubble({ m, streaming, smart }: { m: Msg; streaming?: boolean; smart?: boolean }) {
  const html = useMemo(() => (m.role === 'assistant' ? renderMarkdown(m.content) : ''), [m]);
  if (m.role === 'user')
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-brand px-4 py-2.5 text-[16px] leading-normal whitespace-pre-wrap text-white [overflow-wrap:anywhere]">
          {m.content}
        </div>
      </div>
    );
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-600">
        <Sparkles size={16} />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        {m.content ? (
          <div className="prose-chat [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: html }} />
        ) : streaming ? (
          <Thinking smart={smart} />
        ) : null}
        {streaming && m.content && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-brand align-middle" />}
      </div>
    </div>
  );
}

export function Assistant({ name, grade: initialGrade, ai }: { name: string; grade: string; ai: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [grade, setGrade] = useState(initialGrade || '7');
  const [subject, setSubject] = useState('');
  const [mode, setMode] = useState<'fast' | 'smart'>('fast');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<{ q: string; base: Msg[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Последний диалог хранится в браузере
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || 'null') as { msgs?: Msg[]; subject?: string; mode?: string } | null;
      if (saved?.msgs?.length) setMsgs(saved.msgs.slice(-30));
      if (saved?.subject) setSubject(saved.subject);
      if (saved?.mode === 'smart') setMode('smart');
    } catch {
      /* испорченные данные — начинаем заново */
    }
  }, []);
  useEffect(() => {
    if (busy) return;
    localStorage.setItem(STORE, JSON.stringify({ msgs: msgs.slice(-30), subject, mode }));
  }, [msgs, subject, mode, busy]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [msgs, error]);

  async function ask(question: string, base: Msg[] = msgs) {
    const q = question.trim();
    if (!q || busy || !ai) return;
    const history: Msg[] = [...base, { role: 'user', content: q }];
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setText('');
    if (taRef.current) taRef.current.style.height = '';
    setError('');
    setRetry(null);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let answer = '';
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history, grade, subject, mode }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const out = await res.json().catch(() => ({}));
        throw new Error(out.error || 'Помощник не ответил, попробуйте ещё раз');
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let raw = '';
      let failure = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
        const cut = raw.indexOf(MARK);
        const next = (cut < 0 ? raw : raw.slice(0, cut)).replace(BEAT, '');
        if (cut >= 0) failure = raw.slice(cut + 1).replace(/^ERR:/, '');
        if (next !== answer) {
          answer = next;
          setMsgs((cur) => [...cur.slice(0, -1), { role: 'assistant', content: next }]);
        }
      }
      if (failure) throw new Error(failure.trim() || 'Помощник не ответил, попробуйте ещё раз');
      if (!answer.trim()) throw new Error('Пустой ответ — попробуйте ещё раз или переформулируйте вопрос');
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') {
        if (!answer.trim()) {
          setMsgs(base);
          setText(q);
        }
      } else {
        // Связь оборвалась посреди ответа — браузер пишет непонятное «network error»
        setError(err.name === 'TypeError' ? 'Связь с сайтом прервалась. Проверьте интернет и нажмите «Повторить».' : err.message);
        setRetry({ q, base });
        if (!answer.trim()) {
          setMsgs(base);
          setText(q);
        }
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const empty = msgs.length === 0;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[780px] px-4 py-6 sm:px-6 sm:py-10">
          {empty ? (
            <div className="fade-up">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent-600">
                <Sparkles size={22} />
              </span>
              <h1 className="mt-5 text-[30px] leading-[1.1] font-medium tracking-[-0.02em] sm:text-[40px]">
                {name.split(' ')[0]}, с чем разберёмся?
              </h1>
              <p className="mt-3 max-w-[560px] text-[16px] text-ink-2 sm:text-[17px]">
                Помощник объясняет по шагам, как репетитор: сначала подскажет, потом проверит. Формулы, правила, задачи — по любому предмету.
              </p>
              <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button
                    key={s.text}
                    type="button"
                    disabled={!ai || busy}
                    onClick={() => {
                      if (s.subject) setSubject(s.subject);
                      ask(s.text);
                    }}
                    className="group flex items-start gap-3 rounded-[18px] border border-line bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-tint-2 hover:shadow-soft disabled:pointer-events-none disabled:opacity-60"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-tint text-brand transition-colors group-hover:bg-brand group-hover:text-white">
                      <s.icon size={18} />
                    </span>
                    <span className="text-[15px] leading-snug">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {msgs.map((m, i) => (
                <Bubble key={i} m={m} streaming={busy && i === msgs.length - 1} smart={mode === 'smart'} />
              ))}
            </div>
          )}
          {error && (
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-danger-soft px-4 py-3 text-[15px] text-danger-600">
              <p className="min-w-0 flex-1 basis-60">{error}</p>
              {retry && (
                <button
                  type="button"
                  onClick={() => ask(retry.q, retry.base)}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-[14px] font-medium text-danger-600 shadow-soft hover:bg-white/80"
                >
                  <RefreshCw size={15} /> Повторить
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-line bg-white/80 backdrop-blur">
        <div className="mx-auto w-full max-w-[780px] px-4 pt-3 pb-4 sm:px-6">
          {!ai && (
            <p className="mb-3 rounded-2xl bg-[#fff4cc] px-4 py-3 text-[14px] text-ink">
              ИИ-помощник ещё не подключён. Администратору нужно указать <code className="font-mono text-[13px]">AI_BASE_URL</code> и{' '}
              <code className="font-mono text-[13px]">AI_API_KEY</code> в настройках сервера.
            </p>
          )}
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <select value={grade} onChange={(e) => setGrade(e.target.value)} className="input h-9 w-auto rounded-full py-0 pr-9 pl-3.5 text-[14px]" aria-label="Класс">
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {gradeLabel(g)}
                </option>
              ))}
            </select>
            <select value={subject} onChange={(e) => setSubject(e.target.value)} className="input h-9 w-auto rounded-full py-0 pr-9 pl-3.5 text-[14px]" aria-label="Предмет">
              <option value="">Любой предмет</option>
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="flex rounded-full bg-mist p-0.5" role="group" aria-label="Режим ответа">
              {(
                [
                  ['fast', 'Быстро'],
                  ['smart', 'Подробно'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMode(v)}
                  aria-pressed={mode === v}
                  className={`h-8 rounded-full px-3.5 text-[14px] transition-colors ${mode === v ? 'bg-white font-medium text-brand-800 shadow-soft' : 'text-ink-2 hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {!empty && (
              <button
                type="button"
                onClick={() => {
                  abortRef.current?.abort();
                  setMsgs([]);
                  setError('');
                  setRetry(null);
                }}
                className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[14px] text-ink-2 hover:bg-mist hover:text-ink"
              >
                <RotateCcw size={15} /> Новый диалог
              </button>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(text);
            }}
            className="flex items-end gap-2 rounded-[20px] border-[1.5px] border-line-2 bg-white p-1.5 pl-4 transition-shadow focus-within:border-brand focus-within:shadow-[0_0_0_4px_rgb(18_165_102/0.16)]"
          >
            <textarea
              ref={taRef}
              rows={1}
              value={text}
              disabled={!ai}
              maxLength={4000}
              aria-label="Вопрос помощнику"
              placeholder="Спросите про тему или вставьте условие задачи…"
              onChange={(e) => {
                setText(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(text);
                }
              }}
              className="max-h-[180px] min-h-10 flex-1 resize-none bg-transparent py-2 text-[16px] leading-normal outline-none placeholder:text-ink-3"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Остановить ответ"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-ink text-white"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!ai || !text.trim()}
                aria-label="Отправить"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-brand text-white transition-colors hover:bg-brand-600 disabled:opacity-35"
              >
                <ArrowUp size={19} />
              </button>
            )}
          </form>
          <p className="mt-2 text-center text-[12px] text-ink-3">Помощник может ошибаться — сверяйтесь с учебником и репетитором.</p>
        </div>
      </div>
    </main>
  );
}
