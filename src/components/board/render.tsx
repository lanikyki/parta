'use client';

import { getStroke } from 'perfect-freehand';
import { createContext, memo, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { tryCompile } from '@/lib/board/mathexpr';
import type { GraphItem, Item, PageBg, ShapeItem, StrokeItem, TextItem } from '@/lib/board/types';
import { SHEET } from '@/lib/board/types';
import { renderMathText } from '@/lib/mathtext';
import { textHeight, textHeights } from './geom';

export const GRAPH_COLORS = ['#12a566', '#ff5a5f', '#2f6bff'];

/** Приставка к id узоров и обрезок: у копии листа для печати они свои, иначе браузер возьмёт их из скрытой доски. */
const IdPrefix = createContext('');
export const IdPrefixProvider = IdPrefix.Provider;

function pathFromOutline(points: number[][]) {
  if (!points.length) return '';
  const avg = (a: number, b: number) => (a + b) / 2;
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}Q`;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    d += `${x0.toFixed(1)} ${y0.toFixed(1)} ${avg(x0, x1).toFixed(1)} ${avg(y0, y1).toFixed(1)} `;
  }
  return `${d}Z`;
}

export function strokePath(it: StrokeItem) {
  const real = it.pts.some((p) => p[2] !== 0.5);
  const outline = getStroke(it.pts, {
    size: it.size,
    thinning: it.kind === 'pen' ? 0.55 : 0,
    smoothing: 0.55,
    streamline: 0.4,
    simulatePressure: it.kind === 'pen' && !real,
    last: true,
    start: { cap: true },
    end: { cap: true },
  });
  return pathFromOutline(outline);
}

// Прежние бледные цвета выделителя почти не были видны — старые записи рисуем новыми цветами
const HL_OLD: Record<string, string> = { '#ffd43b': '#ffcc00', '#8ce99a': '#22c55e', '#ffa8d5': '#ec4899', '#91c8ff': '#3b82f6' };

function Stroke({ it }: { it: StrokeItem }) {
  const d = useMemo(() => strokePath(it), [it]);
  if (it.kind === 'highlighter')
    return <path d={d} fill={HL_OLD[it.color] ?? it.color} opacity={0.5} style={{ mixBlendMode: 'multiply' }} />;
  return <path d={d} fill={it.color} />;
}

function Shape({ it }: { it: ShapeItem }) {
  const common = { stroke: it.color, strokeWidth: it.size, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const x = Math.min(it.x1, it.x2);
  const y = Math.min(it.y1, it.y2);
  const w = Math.abs(it.x2 - it.x1);
  const h = Math.abs(it.y2 - it.y1);
  if (it.shape === 'rect') return <rect x={x} y={y} width={w} height={h} rx={Math.min(8, w / 4, h / 4)} {...common} />;
  if (it.shape === 'ellipse') return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />;
  const line = <line x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} {...common} />;
  if (it.shape === 'line') return line;
  const ang = Math.atan2(it.y2 - it.y1, it.x2 - it.x1);
  const len = Math.max(14, it.size * 4.5);
  const a1 = ang + Math.PI * 0.84;
  const a2 = ang - Math.PI * 0.84;
  return (
    <g>
      {line}
      <path
        d={`M${it.x2 + Math.cos(a1) * len} ${it.y2 + Math.sin(a1) * len}L${it.x2} ${it.y2}L${it.x2 + Math.cos(a2) * len} ${it.y2 + Math.sin(a2) * len}`}
        {...common}
      />
    </g>
  );
}

function Text({ it, onMeasure }: { it: TextItem; onMeasure?: () => void }) {
  const html = useMemo(() => renderMathText(it.text), [it.text]);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.scrollHeight;
    if (h && Math.abs((textHeights.get(it.id) ?? 0) - h) > 1) {
      textHeights.set(it.id, h);
      onMeasure?.();
    }
  });
  return (
    <foreignObject x={it.x} y={it.y} width={it.w} height={Math.max(textHeight(it), it.fs * 1.5)} style={{ overflow: 'visible' }}>
      <div
        ref={ref}
        className="board-text"
        style={{ color: it.color, fontSize: it.fs, width: it.w }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </foreignObject>
  );
}

function niceStep(range: number) {
  if (range <= 6) return 1;
  if (range <= 12) return 2;
  if (range <= 30) return 5;
  return 10;
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
/** «x^2 - 4*x» → «x² − 4·x» для подписи графика */
const prettyExpr = (e: string) =>
  e
    .replace(/^\s*y\s*=\s*/i, '')
    .replace(/\^\(?(-?\d+)\)?/g, (_, d: string) => [...d].map((c) => SUP[c] ?? c).join(''))
    .replace(/\*/g, '·')
    .replace(/sqrt/g, '√')
    .replace(/(\S)\s*-\s*/g, '$1 − ')
    .replace(/^-/, '−');

export function GraphView({ it }: { it: Pick<GraphItem, 'x' | 'y' | 'w' | 'h' | 'exprs' | 'range' | 'id'> }) {
  const { w, h, range } = it;
  const sx = w / (range * 2);
  const yRange = (range * h) / w;
  const sy = h / (yRange * 2);
  const X = (x: number) => w / 2 + x * sx;
  const Y = (y: number) => h / 2 - y * sy;
  const step = niceStep(range);
  const curves = useMemo(
    () =>
      it.exprs.map((src) => {
        const { fn } = tryCompile(src.replace(/^\s*y\s*=\s*/i, ''));
        if (!fn) return '';
        let d = '';
        let pen = false;
        const n = 480;
        for (let i = 0; i <= n; i++) {
          const x = -range + (i / n) * range * 2;
          const y = fn(x);
          if (!Number.isFinite(y) || Math.abs(y) > yRange * 6) {
            pen = false;
            continue;
          }
          d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`;
          pen = true;
        }
        return d;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [it.exprs.join('|'), range, w, h],
  );
  const ticks: number[] = [];
  for (let v = -Math.floor(range / step) * step; v <= range; v += step) if (v !== 0) ticks.push(v);
  const yTicks: number[] = [];
  for (let v = -Math.floor(yRange / step) * step; v <= yRange; v += step) if (v !== 0) yTicks.push(v);
  const clip = `${useContext(IdPrefix)}gc-${it.id}`;
  return (
    <g transform={`translate(${it.x} ${it.y})`}>
      <defs>
        <clipPath id={clip}>
          <rect width={w} height={h} rx={12} />
        </clipPath>
      </defs>
      <rect width={w} height={h} rx={12} fill="#fff" stroke="#cfded7" strokeWidth={1.5} />
      <g clipPath={`url(#${clip})`}>
        {ticks.map((v) => (
          <line key={`gx${v}`} x1={X(v)} x2={X(v)} y1={0} y2={h} stroke="#e8f0ec" strokeWidth={1} />
        ))}
        {yTicks.map((v) => (
          <line key={`gy${v}`} y1={Y(v)} y2={Y(v)} x1={0} x2={w} stroke="#e8f0ec" strokeWidth={1} />
        ))}
        <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke="#778982" strokeWidth={1.5} />
        <line y1={0} y2={h} x1={X(0)} x2={X(0)} stroke="#778982" strokeWidth={1.5} />
        {ticks.map((v) => (
          <text key={`tx${v}`} x={X(v)} y={Y(0) + 18} fontSize={13} textAnchor="middle" fill="#778982">
            {v}
          </text>
        ))}
        {yTicks.map((v) => (
          <text key={`ty${v}`} x={X(0) - 6} y={Y(v) + 4} fontSize={13} textAnchor="end" fill="#778982">
            {v}
          </text>
        ))}
        {curves.map((d, i) => d && <path key={i} d={d} fill="none" stroke={GRAPH_COLORS[i % 3]} strokeWidth={3} strokeLinejoin="round" />)}
      </g>
      {it.exprs.map((e, i) => (
        <text key={i} x={14} y={26 + i * 22} fontSize={16} fill={GRAPH_COLORS[i % 3]} fontWeight={500}>
          y = {prettyExpr(e)}
        </text>
      ))}
    </g>
  );
}

export const ItemView = memo(function ItemView({ it, onMeasure }: { it: Item; onMeasure?: () => void }) {
  switch (it.type) {
    case 'stroke':
      return <Stroke it={it} />;
    case 'shape':
      return <Shape it={it} />;
    case 'text':
      return <Text it={it} onMeasure={onMeasure} />;
    case 'image':
      return <image href={it.src} x={it.x} y={it.y} width={it.w} height={it.h} preserveAspectRatio="xMidYMid meet" />;
    case 'graph':
      return <GraphView it={it} />;
  }
});

export function PageBackground({ bg }: { bg: PageBg }) {
  const pre = useContext(IdPrefix);
  return (
    <>
      <defs>
        <pattern id={`${pre}bg-grid`} width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#e2ece7" strokeWidth="1.2" />
        </pattern>
        <pattern id={`${pre}bg-lines`} width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M0 39.5H40" fill="none" stroke="#dbe7e1" strokeWidth="1.2" />
        </pattern>
        <pattern id={`${pre}bg-dots`} width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="20" r="1.8" fill="#c9dbd2" />
        </pattern>
      </defs>
      <rect width={SHEET.w} height={SHEET.h} fill="#fff" />
      {bg !== 'plain' && <rect width={SHEET.w} height={SHEET.h} fill={`url(#${pre}bg-${bg})`} />}
    </>
  );
}
