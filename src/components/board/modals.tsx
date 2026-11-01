'use client';

import katex from 'katex';
import { X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { tryCompile } from '@/lib/board/mathexpr';
import { GRAPH_COLORS, GraphView } from './render';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink/30 p-3" onPointerDown={onClose}>
      <div
        className="max-h-full w-full max-w-[560px] overflow-auto rounded-[22px] bg-white p-5 shadow-lift sm:p-6"
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-medium">{title}</h3>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-mist" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const SNIPPETS: [string, string, number?][] = [
  ['a/b', '\\frac{}{}', 6],
  ['√', '\\sqrt{}', 6],
  ['ⁿ√', '\\sqrt[n]{}', 9],
  ['x²', '^{2}'],
  ['xⁿ', '^{}', 2],
  ['xᵢ', '_{}', 2],
  ['±', '\\pm '],
  ['·', '\\cdot '],
  ['≠', '\\ne '],
  ['≤', '\\le '],
  ['≥', '\\ge '],
  ['≈', '\\approx '],
  ['π', '\\pi '],
  ['α', '\\alpha '],
  ['β', '\\beta '],
  ['∠', '\\angle '],
  ['°', '^\\circ '],
  ['∞', '\\infty '],
  ['Σ', '\\sum_{i=1}^{n} '],
  ['∫', '\\int_{a}^{b} '],
  ['log', '\\log_{}', 6],
  ['sin', '\\sin '],
  ['вектор', '\\vec{}', 5],
  ['система', '\\begin{cases} x + y = 1 \\\\ x - y = 3 \\end{cases}'],
];

export function FormulaModal({ onClose, onInsert }: { onClose: () => void; onInsert: (latex: string) => void }) {
  const [src, setSrc] = useState('x_{1,2} = \\frac{-b \\pm \\sqrt{D}}{2a}');
  const ref = useRef<HTMLTextAreaElement>(null);
  const html = useMemo(() => katex.renderToString(src || '\\square', { throwOnError: false, displayMode: true, output: 'html' }), [src]);
  const insert = (snippet: string, back = 0) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = src.slice(0, start) + snippet + src.slice(end);
    setSrc(next);
    const pos = start + snippet.length - back;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };
  return (
    <Modal title="Формула" onClose={onClose}>
      <div className="grid min-h-[84px] place-items-center overflow-x-auto rounded-2xl bg-mist px-4 py-3 text-[22px]" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SNIPPETS.map(([label, s, back]) => (
          <button
            key={label}
            type="button"
            onClick={() => insert(s, back ?? 0)}
            className="h-9 min-w-9 rounded-[10px] bg-tint px-2.5 text-[14px] text-brand-800 hover:bg-tint-2"
          >
            {label}
          </button>
        ))}
      </div>
      <label className="field mt-4">
        LaTeX
        <textarea
          ref={ref}
          className="input font-mono text-[14px]"
          rows={3}
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      </label>
      <p className="mt-2 text-[13px] text-ink-3">Подсказка: в обычном тексте на доске формулу можно писать между знаками $…$</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn btn-line" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!src.trim()} onClick={() => onInsert(src.trim())}>
          Вставить на доску
        </button>
      </div>
    </Modal>
  );
}

export function GraphModal({ onClose, onInsert }: { onClose: () => void; onInsert: (exprs: string[], range: number) => void }) {
  const [exprs, setExprs] = useState(['x^2 - 4', '', '']);
  const [range, setRange] = useState(5);
  const checks = exprs.map((e) => (e.trim() ? tryCompile(e.replace(/^\s*y\s*=\s*/i, '')) : {}));
  const valid = exprs.filter((e, i) => e.trim() && !checks[i].error);
  return (
    <Modal title="График функции" onClose={onClose}>
      <svg viewBox="0 0 480 300" className="w-full rounded-2xl">
        <GraphView it={{ id: 'preview', x: 0, y: 0, w: 480, h: 300, exprs: valid, range }} />
      </svg>
      <div className="mt-4 grid gap-2">
        {exprs.map((e, i) => (
          <label key={i} className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: GRAPH_COLORS[i] }} />
            <span className="w-8 shrink-0 font-mono text-[14px] text-ink-2">y =</span>
            <input
              className="input h-11 font-mono text-[15px]"
              value={e}
              placeholder={i === 0 ? 'x^2 - 4' : 'ещё функция (необязательно)'}
              onChange={(ev) => setExprs((list) => list.map((v, j) => (j === i ? ev.target.value : v)))}
              spellCheck={false}
              autoFocus={i === 0}
            />
          </label>
        ))}
        {checks.map((c, i) => c.error && <p key={i} className="text-[13px] text-danger-600">Функция {i + 1}: {c.error}</p>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
        Масштаб:
        {[2, 5, 10, 20].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`h-8 rounded-full px-3 ${range === r ? 'bg-brand text-white' : 'bg-tint text-brand-800'}`}
          >
            ±{r}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[13px] text-ink-3">Можно: + − * / ^, скобки, sqrt(x), |x|, sin, cos, tg, ln, log, pi. Например: 2x + 1, sqrt(x), 1/x</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn btn-line" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!valid.length} onClick={() => onInsert(valid, range)}>
          Вставить на доску
        </button>
      </div>
    </Modal>
  );
}
