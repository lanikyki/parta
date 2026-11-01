'use client';

import {
  Brush,
  ChartSpline,
  ChevronLeft,
  ChevronRight,
  Circle,
  Ellipsis,
  Eraser,
  FileUp,
  Grid3x3,
  Grip,
  Hand,
  Highlighter,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Minus,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Plus,
  Redo2,
  Rows3,
  Sigma,
  Square,
  Trash2,
  Type,
  Undo2,
  Users,
} from 'lucide-react';
import type { Room } from 'livekit-client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { GraphItem, ImageItem, Item, Page, PageBg, ShapeItem, StrokeItem, TextItem } from '@/lib/board/types';
import { SHEET, livePages } from '@/lib/board/types';
import { type P, bbox, hit, r1, translate, zSort } from './geom';
import { fitInSheet, importPdf, uploadImage } from './media';
import { FormulaModal, GraphModal } from './modals';
import { ItemView, PageBackground } from './render';
import { BoardStore, type Me, nextV, useBoardSync } from './sync';

type Tool = 'select' | 'hand' | 'pen' | 'marker' | 'highlighter' | 'eraser' | 'shape' | 'text' | 'laser';
type ShapeKind = ShapeItem['shape'];
type View = { s: number; x: number; y: number };
type Entry = { before: Item | null; after: Item };
type Gesture =
  | { kind: 'draw'; item: StrokeItem; sent: number }
  | { kind: 'shape'; item: ShapeItem }
  | { kind: 'erase'; entries: Map<string, Entry>; last: P }
  | { kind: 'move'; orig: Item; start: P; moved: boolean; cur: Item }
  | { kind: 'pan'; start: P; view: View }
  | { kind: 'pinch'; d0: number; m0: P; view: View }
  | { kind: 'laser' };
type Editing = { id: string | null; x: number; y: number; w: number; fs: number; color: string; text: string; orig?: TextItem };

const COLORS = ['#0f1f1a', '#12a566', '#2f6bff', '#e5484d', '#ff8a00', '#7c4dff', '#ff4f9a'];
const HL_COLORS = ['#ffd43b', '#8ce99a', '#ffa8d5', '#91c8ff'];
const SIZES: Record<'pen' | 'marker' | 'highlighter' | 'shape' | 'text', number[]> = {
  pen: [2.5, 4.5, 8],
  marker: [8, 13, 20],
  highlighter: [18, 28, 42],
  shape: [2.5, 4.5, 8],
  text: [24, 32, 46],
};
const MIN_S = 0.12;
const MAX_S = 5;
const uid = () => crypto.randomUUID();
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function LaserIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="#ff3b45" />
      <circle cx="12" cy="12" r="8" fill="none" stroke="#ff3b45" strokeOpacity=".35" strokeWidth="2" />
    </svg>
  );
}

function ToolButton({
  active,
  title,
  onClick,
  disabled,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-[11px] transition-colors disabled:opacity-35 ${
        active ? 'bg-brand text-white' : 'text-ink-2 hover:bg-tint hover:text-brand-800'
      }`}
    >
      {children}
    </button>
  );
}

export function Board({ code, room, me }: { code: string; room: Room | null; me: Me }) {
  const storeRef = useRef<BoardStore | null>(null);
  if (!storeRef.current) storeRef.current = new BoardStore();
  const store = storeRef.current;
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const sync = useBoardSync({ code, room, me, store });

  const pages = useMemo(() => livePages(store.snap), [version, store]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pageId, setPageId] = useState('p1');
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const pageIdx = page ? pages.indexOf(page) : 0;
  const followLocked = !me.isHost && sync.follow.on;
  const canDraw = me.isHost || sync.perm.draw;

  const items = useMemo(
    () => Object.values(store.snap.items).filter((i) => !i.deleted && i.page === page?.id).sort(zSort),
    [version, page?.id, store], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Ведущий: «Все за мной»
  useEffect(() => {
    if (followLocked && sync.follow.page && store.snap.pages[sync.follow.page] && !store.snap.pages[sync.follow.page].deleted)
      setPageId(sync.follow.page);
  }, [followLocked, sync.follow.page, version, store]);
  useEffect(() => {
    if (me.isHost && sync.follow.on && page && sync.follow.page !== page.id) sync.setFollow(true, page.id);
  }, [me.isHost, sync, page]);

  // Инструменты
  const [tool, setTool] = useState<Tool>('pen');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const [color, setColor] = useState(COLORS[1]);
  const [hlColor, setHlColor] = useState(HL_COLORS[0]);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [menu, setMenu] = useState<null | 'shapes' | 'bg' | 'pages'>(null);
  const [modal, setModal] = useState<null | 'formula' | 'graph'>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Вид
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const compact = size.w > 0 && size.w < 700;
  // очень узкий экран (телефоны шириной до ~380px): панели раскладываем плотнее
  const tiny = size.w > 0 && size.w < 380;
  const [view, setView] = useState<View>({ s: 0.5, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const autoFit = useRef(true);

  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    const ins = w < 700 ? { l: 8, r: 8, t: 56, b: 116 } : { l: 72, r: 16, t: 60, b: 70 };
    const aw = Math.max(50, w - ins.l - ins.r);
    const ah = Math.max(50, h - ins.t - ins.b);
    const s = Math.min(aw / SHEET.w, ah / SHEET.h);
    setView({ s, x: ins.l + (aw - SHEET.w * s) / 2, y: ins.t + (ah - SHEET.h * s) / 2 });
    autoFit.current = true;
  }, []);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (autoFit.current) fit();
  }, [size.w, size.h, fit]);

  const setViewManual = (v: View) => {
    autoFit.current = false;
    setView(v);
  };
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    const v = viewRef.current;
    const s = clamp(v.s * factor, MIN_S, MAX_S);
    autoFit.current = false;
    setView({ s, x: cx - (cx - v.x) * (s / v.s), y: cy - (cy - v.y) * (s / v.s) });
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-ui]')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else {
        autoFit.current = false;
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // История (свои действия)
  const undoStack = useRef<Entry[][]>([]);
  const redoStack = useRef<Entry[][]>([]);
  const [, setHistTick] = useState(0);
  const record = (entries: Entry[]) => {
    if (!entries.length) return;
    undoStack.current.push(entries);
    if (undoStack.current.length > 200) undoStack.current.shift();
    redoStack.current = [];
    setHistTick((t) => t + 1);
  };
  const undo = useCallback(() => {
    const e = undoStack.current.pop();
    if (!e) return;
    sync.commit(e.map(({ before, after }) => (before ? { ...before, v: nextV() } : ({ ...after, deleted: true, v: nextV() } as Item))));
    redoStack.current.push(e);
    setHistTick((t) => t + 1);
  }, [sync]);
  const redo = useCallback(() => {
    const e = redoStack.current.pop();
    if (!e) return;
    sync.commit(e.map(({ after }) => ({ ...after, v: nextV() })));
    undoStack.current.push(e);
    setHistTick((t) => t + 1);
  }, [sync]);

  // Черновик (то, что рисуется прямо сейчас)
  const [draft, setDraft] = useState<Item | null>(null);
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const raf = useRef(0);
  const pendingDraft = useRef<Item | null>(null);
  const scheduleDraft = (it: Item) => {
    pendingDraft.current = it;
    if (!raf.current)
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        setDraft(pendingDraft.current);
      });
  };
  const clearDraft = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    pendingDraft.current = null;
    setDraft(null);
  };

  const selectedItem = selected ? items.find((i) => i.id === selected) : undefined;
  useEffect(() => {
    if (selected && !selectedItem) setSelected(null);
  }, [selected, selectedItem]);
  useEffect(() => {
    setSelected(null);
  }, [page?.id]);

  // Текст
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const startEdit = (it: TextItem | null, p?: P) => {
    setSelected(null);
    if (it) {
      setHiddenId(it.id);
      setEditing({ id: it.id, x: it.x, y: it.y, w: it.w, fs: it.fs, color: it.color, text: it.text, orig: it });
    } else if (p) {
      const fs = SIZES.text[sizeIdx];
      const x = clamp(p.x, 0, SHEET.w - 160);
      setEditing({ id: null, x, y: Math.max(0, p.y - fs * 0.7), w: Math.max(160, Math.min(720, SHEET.w - x - 16)), fs, color, text: '' });
    }
  };
  const commitText = () => {
    const ed = editingRef.current;
    if (!ed || !page) return;
    editingRef.current = null;
    setEditing(null);
    setHiddenId(null);
    const text = ed.text.replace(/\s+$/, '');
    if (ed.orig) {
      if (!text) {
        const tomb = { ...ed.orig, deleted: true, v: nextV() };
        sync.commit([tomb]);
        record([{ before: ed.orig, after: tomb }]);
      } else if (text !== ed.orig.text) {
        const it = { ...ed.orig, text, v: nextV() };
        sync.commit([it]);
        record([{ before: ed.orig, after: it }]);
      }
    } else if (text) {
      const it: TextItem = { id: uid(), type: 'text', page: page.id, v: nextV(), by: me.identity, x: ed.x, y: ed.y, w: ed.w, text, color: ed.color, fs: ed.fs };
      sync.commit([it]);
      record([{ before: null, after: it }]);
    }
  };

  // Лазер
  const [myLaser, setMyLaser] = useState<P | null>(null);
  const laserSent = useRef(0);
  const showLaser = (p: P) => {
    setMyLaser(p);
    if (page && Date.now() - laserSent.current > 40) {
      laserSent.current = Date.now();
      sync.sendLaser(p.x, p.y, page.id);
    }
  };
  useEffect(() => {
    if (tool !== 'laser') setMyLaser(null);
  }, [tool]);

  // Указатель
  const pointers = useRef(new Map<number, P>());
  const g = useRef<Gesture | null>(null);
  const spaceDown = useRef(false);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toSheet = (pt: P) => ({ x: r1((pt.x - viewRef.current.x) / viewRef.current.s), y: r1((pt.y - viewRef.current.y) / viewRef.current.s) });
  const topHit = (p: P, mode: 'select' | 'erase') => {
    const tol = 8 / viewRef.current.s;
    const list = itemsRef.current;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].id !== hiddenId && hit(list[i], p, tol, mode)) return list[i];
    return undefined;
  };
  const eraseAt = (p: P) => {
    const cur = g.current;
    if (cur?.kind !== 'erase') return;
    const tol = 8 / viewRef.current.s;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - cur.last.x, p.y - cur.last.y) / tol));
    const out: Item[] = [];
    for (let k = 1; k <= steps; k++) {
      const q = { x: cur.last.x + ((p.x - cur.last.x) * k) / steps, y: cur.last.y + ((p.y - cur.last.y) * k) / steps };
      for (const it of itemsRef.current) {
        if (cur.entries.has(it.id) || !hit(it, q, tol, 'erase')) continue;
        const tomb = { ...it, deleted: true, v: nextV() } as Item;
        cur.entries.set(it.id, { before: it, after: tomb });
        out.push(tomb);
      }
    }
    cur.last = p;
    if (out.length) sync.commit(out);
  };
  const cancelGesture = () => {
    const cur = g.current;
    g.current = null;
    if (cur?.kind === 'move') setHiddenId(null);
    clearDraft();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setMenu(null);
    if (editingRef.current) {
      commitText();
      return;
    }
    if (e.button === 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = local(e);
    pointers.current.set(e.pointerId, pt);
    if (pointers.current.size === 2) {
      cancelGesture();
      const [a, b] = [...pointers.current.values()];
      g.current = { kind: 'pinch', d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: viewRef.current };
      return;
    }
    if (pointers.current.size > 2 || !page) return;
    const p = toSheet(pt);
    if (tool === 'hand' || e.button === 1 || spaceDown.current) {
      g.current = { kind: 'pan', start: pt, view: viewRef.current };
      return;
    }
    const pressure = e.pointerType === 'pen' ? Math.round(e.pressure * 100) / 100 : 0.5;
    switch (tool) {
      case 'pen':
      case 'marker':
      case 'highlighter': {
        if (!canDraw) return;
        const item: StrokeItem = {
          id: uid(),
          type: 'stroke',
          kind: tool,
          page: page.id,
          v: 0,
          by: me.identity,
          pts: [[p.x, p.y, pressure]],
          color: tool === 'highlighter' ? hlColor : color,
          size: SIZES[tool][sizeIdx],
        };
        g.current = { kind: 'draw', item, sent: 0 };
        scheduleDraft(item);
        break;
      }
      case 'shape': {
        if (!canDraw) return;
        const item: ShapeItem = { id: uid(), type: 'shape', shape: shapeKind, page: page.id, v: 0, by: me.identity, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, size: SIZES.shape[sizeIdx] };
        g.current = { kind: 'shape', item };
        break;
      }
      case 'eraser':
        if (!canDraw) return;
        g.current = { kind: 'erase', entries: new Map(), last: p };
        eraseAt(p);
        break;
      case 'select': {
        const target = canDraw ? topHit(p, 'select') : undefined;
        if (target) {
          setSelected(target.id);
          g.current = { kind: 'move', orig: target, start: p, moved: false, cur: target };
        } else {
          setSelected(null);
          g.current = { kind: 'pan', start: pt, view: viewRef.current };
        }
        break;
      }
      case 'text': {
        if (!canDraw) return;
        const target = topHit(p, 'select');
        if (target?.type === 'text') startEdit(target);
        else startEdit(null, p);
        break;
      }
      case 'laser':
        g.current = { kind: 'laser' };
        showLaser(p);
        break;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, pt);
    if (tool === 'laser' && page && e.pointerType !== 'touch') showLaser(toSheet(pt));
    const cur = g.current;
    if (!cur) return;
    switch (cur.kind) {
      case 'pinch': {
        const [a, b] = [...pointers.current.values()];
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const s = clamp((cur.view.s * d) / cur.d0, MIN_S, MAX_S);
        const sx = (cur.m0.x - cur.view.x) / cur.view.s;
        const sy = (cur.m0.y - cur.view.y) / cur.view.s;
        setViewManual({ s, x: m.x - sx * s, y: m.y - sy * s });
        break;
      }
      case 'pan':
        setViewManual({ ...cur.view, x: cur.view.x + pt.x - cur.start.x, y: cur.view.y + pt.y - cur.start.y });
        break;
      case 'draw': {
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
        const pts = [...cur.item.pts];
        const minD = 0.8 / viewRef.current.s;
        for (const ce of events.length ? events : [e.nativeEvent]) {
          const q = toSheet(local(ce));
          const last = pts[pts.length - 1];
          if (Math.hypot(q.x - last[0], q.y - last[1]) < minD) continue;
          pts.push([q.x, q.y, ce.pointerType === 'pen' ? Math.round(ce.pressure * 100) / 100 : 0.5]);
        }
        if (pts.length === cur.item.pts.length) return;
        cur.item = { ...cur.item, pts };
        scheduleDraft(cur.item);
        if (Date.now() - cur.sent > 90) {
          cur.sent = Date.now();
          sync.sendLive(cur.item);
        }
        break;
      }
      case 'shape': {
        const p = toSheet(pt);
        let { x, y } = p;
        const it = cur.item;
        if (e.shiftKey) {
          const dx = x - it.x1;
          const dy = y - it.y1;
          if (it.shape === 'rect' || it.shape === 'ellipse') {
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            x = it.x1 + Math.sign(dx || 1) * m;
            y = it.y1 + Math.sign(dy || 1) * m;
          } else {
            const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(dx, dy);
            x = r1(it.x1 + Math.cos(ang) * len);
            y = r1(it.y1 + Math.sin(ang) * len);
          }
        }
        cur.item = { ...it, x2: x, y2: y };
        scheduleDraft(cur.item);
        break;
      }
      case 'erase':
        eraseAt(toSheet(pt));
        break;
      case 'move': {
        const p = toSheet(pt);
        const dx = p.x - cur.start.x;
        const dy = p.y - cur.start.y;
        if (!cur.moved && Math.hypot(dx, dy) * viewRef.current.s < 3) return;
        if (!cur.moved) setHiddenId(cur.orig.id);
        cur.moved = true;
        cur.cur = translate(cur.orig, dx, dy);
        scheduleDraft(cur.cur);
        break;
      }
      case 'laser':
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const cur = g.current;
    if (!cur) return;
    if (cur.kind === 'pinch') {
      if (pointers.current.size < 2) g.current = null;
      return;
    }
    g.current = null;
    switch (cur.kind) {
      case 'draw': {
        const it: StrokeItem = { ...cur.item, v: nextV() };
        if (it.pts.length === 1) it.pts = [it.pts[0], [it.pts[0][0] + 0.2, it.pts[0][1] + 0.2, it.pts[0][2]]];
        sync.commit([it]);
        record([{ before: null, after: it }]);
        clearDraft();
        break;
      }
      case 'shape': {
        clearDraft();
        const it: ShapeItem = { ...cur.item, v: nextV() };
        if (Math.hypot(it.x2 - it.x1, it.y2 - it.y1) * viewRef.current.s < 4) return;
        sync.commit([it]);
        record([{ before: null, after: it }]);
        break;
      }
      case 'erase':
        record([...cur.entries.values()]);
        break;
      case 'move': {
        clearDraft();
        setHiddenId(null);
        if (!cur.moved) return;
        const it = { ...cur.cur, v: nextV() } as Item;
        sync.commit([it]);
        record([{ before: cur.orig, after: it }]);
        break;
      }
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (g.current?.kind === 'draw') onPointerUp(e);
    else cancelGesture();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== 'select' || !canDraw) return;
    const target = topHit(toSheet(local(e)), 'select');
    if (target?.type === 'text') startEdit(target);
  };

  const deleteSelected = useCallback(() => {
    const it = itemsRef.current.find((i) => i.id === selected);
    if (!it) return;
    const tomb = { ...it, deleted: true, v: nextV() } as Item;
    sync.commit([tomb]);
    record([{ before: it, after: tomb }]);
    setSelected(null);
  }, [selected, sync]); // eslint-disable-line react-hooks/exhaustive-deps

  // Клавиатура
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || editingRef.current || modal) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && (key === 'z' || key === 'я')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (key === 'y' || key === 'н')) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.code === 'Space' && !spaceDown.current) {
        spaceDown.current = true;
        e.preventDefault();
        return;
      }
      const map: Record<string, Tool> = { KeyV: 'select', KeyH: 'hand', KeyP: 'pen', KeyM: 'marker', KeyI: 'highlighter', KeyE: 'eraser', KeyT: 'text', KeyL: 'laser', KeyS: 'shape' };
      if (map[e.code]) setTool(map[e.code]);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [undo, redo, selected, deleteSelected, modal]);

  // Действия
  const center = () => {
    const c = toSheet({ x: size.w / 2, y: size.h / 2 });
    return { x: clamp(c.x, 100, SHEET.w - 100), y: clamp(c.y, 100, SHEET.h - 100) };
  };
  /** Левый верхний угол для нового объекта: рядом с центром экрана, но не поверх уже нарисованного. */
  const place = (w: number, h: number) => {
    const c = center();
    const boxes = itemsRef.current.filter((i) => !(i.type === 'image' && i.locked)).map(bbox);
    const fit = (x: number, y: number) => ({ x: clamp(x, 10, Math.max(10, SHEET.w - w - 10)), y: clamp(y, 10, Math.max(10, SHEET.h - h - 10)) });
    const free = (p: { x: number; y: number }) =>
      !boxes.some((b) => p.x < b.x + b.w + 16 && p.x + w + 16 > b.x && p.y < b.y + b.h + 16 && p.y + h + 16 > b.y);
    const base = fit(c.x - w / 2, c.y - h / 2);
    if (free(base)) return base;
    // Ищем свободное место по расширяющимся кольцам вокруг центра
    for (let ring = 1; ring <= 6; ring++)
      for (let k = 0; k < 8 * ring; k++) {
        const a = (k / (8 * ring)) * Math.PI * 2;
        const p = fit(base.x + Math.cos(a) * ring * 120, base.y + Math.sin(a) * ring * 90);
        if (free(p)) return p;
      }
    return fit(base.x + 40, base.y + 40);
  };
  const addItems = (list: Item[]) => {
    sync.commit(list);
    record(list.map((after) => ({ before: null, after })));
  };
  const insertFormula = (latex: string) => {
    if (!page) return;
    const w = 640;
    const p = place(w, 90);
    addItems([{ id: uid(), type: 'text', page: page.id, v: nextV(), by: me.identity, x: r1(p.x), y: r1(p.y), w, text: `$$${latex}$$`, color, fs: 34 }]);
    setModal(null);
    setTool('select');
  };
  const insertGraph = (exprs: string[], range: number) => {
    if (!page) return;
    const p = place(640, 420);
    const it: GraphItem = { id: uid(), type: 'graph', page: page.id, v: nextV(), by: me.identity, x: r1(p.x), y: r1(p.y), w: 640, h: 420, exprs, range };
    addItems([it]);
    setModal(null);
    setTool('select');
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const onImage = async (file?: File) => {
    if (!file || !page) return;
    setBusy('Загружаю картинку…');
    setError('');
    try {
      const { url, w, h } = await uploadImage(code, file);
      const k = Math.min(1, 720 / w, 560 / h);
      const p = place(w * k, h * k);
      const it: ImageItem = { id: uid(), type: 'image', page: page.id, v: nextV(), by: me.identity, x: r1(p.x), y: r1(p.y), w: r1(w * k), h: r1(h * k), src: url };
      addItems([it]);
      setTool('select');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const insertPagesAfter = (count: number) => {
    const cur = page ?? pages[pages.length - 1];
    const next = pages[pages.indexOf(cur) + 1];
    const a = cur ? cur.idx : 0;
    const b = next ? next.idx : a + 1;
    return Array.from({ length: count }, (_, i) => a + ((b - a) * (i + 1)) / (count + 1));
  };
  const addPage = () => {
    const [idx] = insertPagesAfter(1);
    const p: Page = { id: uid().slice(0, 8), idx, bg: page?.bg ?? 'grid', v: nextV() };
    sync.commit([], [p]);
    setPageId(p.id);
  };
  const onPdf = async (file?: File) => {
    if (!file) return;
    setError('');
    setBusy('Открываю PDF…');
    try {
      const shots = await importPdf(code, file, (done, total) => setBusy(`Загружаю страницы: ${done} из ${total}`));
      const idxs = insertPagesAfter(shots.length);
      const newPages: Page[] = [];
      const newItems: Item[] = [];
      shots.forEach((s, i) => {
        const p: Page = { id: uid().slice(0, 8), idx: idxs[i], bg: 'plain', v: nextV() };
        newPages.push(p);
        newItems.push({ id: uid(), type: 'image', page: p.id, v: nextV(), by: me.identity, src: s.url, locked: true, ...fitInSheet(s.w, s.h, 0) });
      });
      sync.commit(newItems, newPages);
      if (newPages[0]) setPageId(newPages[0].id);
    } catch (err) {
      console.error(err);
      setError('Не удалось открыть PDF. Попробуйте другой файл.');
    } finally {
      setBusy('');
    }
  };
  const setBg = (bg: PageBg) => {
    if (page) sync.commit([], [{ ...page, bg, v: nextV() }]);
    setMenu(null);
  };
  const deletePage = () => {
    if (!page || pages.length < 2) return;
    if (!confirm('Удалить этот лист?')) return;
    const nextPage = pages[pageIdx + 1] ?? pages[pageIdx - 1];
    sync.commit([], [{ ...page, deleted: true, v: nextV() }]);
    setPageId(nextPage.id);
  };
  const goPage = (d: number) => {
    const p = pages[clamp(pageIdx + d, 0, pages.length - 1)];
    if (p) setPageId(p.id);
  };

  const drawTool = tool === 'pen' || tool === 'marker' || tool === 'highlighter' || tool === 'shape' || tool === 'text';
  const sizeKey = (tool === 'pen' || tool === 'marker' || tool === 'highlighter' || tool === 'shape' || tool === 'text' ? tool : 'pen') as keyof typeof SIZES;
  const cursor = { select: 'default', hand: 'grab', pen: 'crosshair', marker: 'crosshair', highlighter: 'crosshair', eraser: 'cell', shape: 'crosshair', text: 'text', laser: 'none' }[tool];
  const ShapeIcon = { line: Minus, arrow: MoveUpRight, rect: Square, ellipse: Circle }[shapeKind];

  const liveStrokes = useMemo(
    () => [...sync.live.strokes.values()].map((s) => s.it).filter((it) => it.page === page?.id),
    [sync.liveVersion, page?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const lasers = useMemo(
    () => [...sync.live.lasers.entries()].filter(([, l]) => l.page === page?.id),
    [sync.liveVersion, page?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [, setMeasureTick] = useState(0);
  const onMeasure = useCallback(() => setMeasureTick((t) => t + 1), []);

  const selBox = selectedItem && selectedItem.id !== hiddenId ? bbox(selectedItem) : null;
  const k = view.s;

  const tools: [Tool, string, React.ReactNode][] = [
    ['select', 'Выбор и перемещение (V)', <MousePointer2 key="s" size={19} />],
    ['hand', 'Рука — двигать лист (H, пробел)', <Hand key="h" size={19} />],
    ['pen', 'Ручка (P)', <PenLine key="p" size={19} />],
    ['marker', 'Маркер (M)', <Brush key="m" size={19} />],
    ['highlighter', 'Текстовыделитель (I)', <Highlighter key="i" size={19} />],
    ['eraser', 'Ластик (E)', <Eraser key="e" size={19} />],
  ];

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none overflow-hidden bg-[#f1f6f3] select-none">
      {/* Холст */}
      <div
        className="absolute inset-0"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => tool === 'laser' && setMyLaser(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg width={size.w} height={size.h} className="block">
          <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
            <rect x={-2 / k} y={4 / k} width={SHEET.w + 4 / k} height={SHEET.h} rx={6} fill="rgb(10 60 40 / .07)" />
            <PageBackground bg={page?.bg ?? 'grid'} />
            {items.map((it) => (it.id === hiddenId ? null : <ItemView key={it.id} it={it} onMeasure={onMeasure} />))}
            {liveStrokes.map((it) => (
              <g key={`live-${it.id}`} opacity={0.85}>
                <ItemView it={it} />
              </g>
            ))}
            {draft && <ItemView it={draft} />}
            {selBox && (
              <rect
                x={selBox.x - 6 / k}
                y={selBox.y - 6 / k}
                width={selBox.w + 12 / k}
                height={selBox.h + 12 / k}
                fill="none"
                stroke="#12a566"
                strokeWidth={1.5 / k}
                strokeDasharray={`${6 / k} ${4 / k}`}
                rx={6 / k}
              />
            )}
            {lasers.map(([id, l]) => (
              <g key={id} transform={`translate(${l.x} ${l.y})`}>
                <circle r={14 / k} fill="#ff3b45" opacity={0.2} />
                <circle r={6 / k} fill="#ff3b45" />
                <text y={28 / k} fontSize={12 / k} textAnchor="middle" fill="#e23d45" fontWeight={600}>
                  {l.name}
                </text>
              </g>
            ))}
            {myLaser && (
              <g transform={`translate(${myLaser.x} ${myLaser.y})`} pointerEvents="none">
                <circle r={14 / k} fill="#ff3b45" opacity={0.2} />
                <circle r={6 / k} fill="#ff3b45" />
              </g>
            )}
          </g>
        </svg>
      </div>

      {/* Кнопка удаления выделенного */}
      {selBox && canDraw && (
        <button
          type="button"
          data-ui
          onClick={deleteSelected}
          className="absolute z-10 grid h-8 w-8 place-items-center rounded-full bg-white text-accent-600 shadow-soft hover:bg-accent-soft"
          style={{ left: view.x + (selBox.x + selBox.w) * k + 2, top: view.y + selBox.y * k - 38 }}
          aria-label="Удалить"
          title="Удалить (Delete)"
        >
          <Trash2 size={16} />
        </button>
      )}

      {/* Редактор текста */}
      {editing && (
        <textarea
          data-ui
          autoFocus
          value={editing.text}
          placeholder="Текст. Формулы — между $…$"
          onChange={(e) => {
            const v = e.target.value;
            setEditing((ed) => (ed ? { ...ed, text: v } : ed));
            e.target.style.height = 'auto';
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              commitText();
            }
          }}
          className="absolute z-20 resize-none overflow-hidden rounded-md bg-white/95 p-0 outline-2 outline-offset-4 outline-brand outline-dashed"
          style={{
            left: view.x + editing.x * k,
            top: view.y + editing.y * k,
            width: editing.w * k,
            minHeight: editing.fs * k * 1.5,
            fontSize: editing.fs * k,
            lineHeight: 1.4,
            color: editing.color,
            fontFamily: 'var(--font-sans)',
          }}
          rows={Math.max(1, editing.text.split('\n').length)}
        />
      )}

      {/* Панель инструментов */}
      <div
        data-ui
        className={`absolute z-10 flex gap-1 rounded-2xl bg-white p-1.5 shadow-lift ${
          compact ? 'right-2 bottom-2 left-2 overflow-x-auto' : 'top-1/2 left-3 -translate-y-1/2 flex-col'
        }`}
      >
        {tools.map(([t, title, icon]) => (
          <ToolButton key={t} title={title} active={tool === t} disabled={!canDraw && t !== 'hand' && t !== 'select'} onClick={() => setTool(t)}>
            {icon}
          </ToolButton>
        ))}
        <div className="relative">
          <ToolButton
            title="Фигуры (S)"
            active={tool === 'shape'}
            disabled={!canDraw}
            onClick={() => {
              setTool('shape');
              setMenu(menu === 'shapes' ? null : 'shapes');
            }}
          >
            <ShapeIcon size={19} />
          </ToolButton>
          {menu === 'shapes' && (
            <div className={`absolute z-20 flex gap-1 rounded-xl bg-white p-1.5 shadow-lift ${compact ? 'bottom-12 left-0' : 'top-0 left-12'}`}>
              {(
                [
                  ['line', 'Линия', Minus],
                  ['arrow', 'Стрелка', MoveUpRight],
                  ['rect', 'Прямоугольник', Square],
                  ['ellipse', 'Эллипс', Circle],
                ] as const
              ).map(([s, title, Icon]) => (
                <ToolButton
                  key={s}
                  title={title}
                  active={shapeKind === s}
                  onClick={() => {
                    setShapeKind(s);
                    setTool('shape');
                    setMenu(null);
                  }}
                >
                  <Icon size={19} />
                </ToolButton>
              ))}
            </div>
          )}
        </div>
        <ToolButton title="Текст (T)" active={tool === 'text'} disabled={!canDraw} onClick={() => setTool('text')}>
          <Type size={19} />
        </ToolButton>
        <ToolButton title="Формула" disabled={!canDraw} onClick={() => setModal('formula')}>
          <Sigma size={19} />
        </ToolButton>
        <ToolButton title="График функции" disabled={!canDraw} onClick={() => setModal('graph')}>
          <ChartSpline size={19} />
        </ToolButton>
        <ToolButton title="Картинка" disabled={!canDraw} onClick={() => fileRef.current?.click()}>
          <ImagePlus size={19} />
        </ToolButton>
        <ToolButton title="Лазерная указка (L)" active={tool === 'laser'} onClick={() => setTool('laser')}>
          <LaserIcon />
        </ToolButton>
        <span className={compact ? 'mx-0.5 w-px shrink-0 self-stretch bg-line' : 'my-0.5 h-px bg-line'} />
        <ToolButton title="Отменить (Ctrl+Z)" disabled={!undoStack.current.length} onClick={undo}>
          <Undo2 size={19} />
        </ToolButton>
        <ToolButton title="Вернуть (Ctrl+Shift+Z)" disabled={!redoStack.current.length} onClick={redo}>
          <Redo2 size={19} />
        </ToolButton>
      </div>

      {/* Цвет и толщина */}
      {drawTool && canDraw && (
        <div
          data-ui
          className={`absolute z-10 flex items-center rounded-2xl bg-white px-2.5 py-2 shadow-lift ${compact ? 'bottom-[64px] left-2 max-w-[calc(100%-16px)] gap-1 overflow-x-auto' : 'bottom-3 left-3 gap-1.5'}`}
        >
          {(tool === 'highlighter' ? HL_COLORS : COLORS).map((c) => {
            const active = (tool === 'highlighter' ? hlColor : color) === c;
            return (
              <button
                key={c}
                type="button"
                aria-label={`Цвет ${c}`}
                onClick={() => (tool === 'highlighter' ? setHlColor(c) : setColor(c))}
                className={`h-6 w-6 shrink-0 rounded-full transition-transform ${active ? 'scale-110 ring-2 ring-brand ring-offset-2' : 'hover:scale-110'}`}
                style={{ background: c }}
              />
            );
          })}
          <span className="mx-1 h-5 w-px shrink-0 bg-line" />
          {[0, 1, 2].map((i) => (
            <button
              key={i}
              type="button"
              aria-label={['Тонко', 'Средне', 'Толсто'][i]}
              title={['Тонко', 'Средне', 'Толсто'][i]}
              onClick={() => setSizeIdx(i)}
              className={`grid h-8 shrink-0 place-items-center rounded-lg ${compact ? 'w-7' : 'w-8'} ${sizeIdx === i ? 'bg-tint' : 'hover:bg-mist'}`}
            >
              {sizeKey === 'text' ? (
                <span className="font-medium text-ink" style={{ fontSize: [12, 15, 19][i] }}>
                  A
                </span>
              ) : (
                <span className="rounded-full bg-ink" style={{ width: [4, 7, 11][i], height: [4, 7, 11][i] }} />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Листы */}
      <div
        data-ui
        className={`absolute z-10 flex items-center gap-0.5 rounded-2xl bg-white p-1 shadow-lift ${
          compact ? 'top-2 left-2' : drawTool && canDraw && size.w < 1100 ? 'right-3 bottom-3' : 'bottom-3 left-1/2 -translate-x-1/2'
        }`}
      >
        <ToolButton title="Предыдущий лист" disabled={pageIdx === 0 || followLocked} onClick={() => goPage(-1)}>
          <ChevronLeft size={19} />
        </ToolButton>
        <span className={`px-1 text-center font-mono text-[13px] text-ink-2 ${compact ? 'min-w-[44px]' : 'min-w-[64px]'}`}>
          {pageIdx + 1} / {pages.length}
        </span>
        <ToolButton title="Следующий лист" disabled={pageIdx >= pages.length - 1 || followLocked} onClick={() => goPage(1)}>
          <ChevronRight size={19} />
        </ToolButton>
        {canDraw && compact && (
          <div className="relative">
            <ToolButton title="Листы и фон" active={menu === 'pages'} onClick={() => setMenu(menu === 'pages' ? null : 'pages')}>
              <Ellipsis size={19} />
            </ToolButton>
            {menu === 'pages' && (
              <div className="absolute top-12 left-0 z-20 grid w-52 gap-0.5 rounded-xl bg-white p-1.5 shadow-lift">
                {(
                  [
                    ['Новый лист', Plus, addPage],
                    ['Загрузить PDF', FileUp, () => pdfRef.current?.click()],
                    ...(pages.length > 1 ? ([['Удалить лист', Trash2, deletePage]] as const) : []),
                  ] as const
                ).map(([label, Icon, act]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      act();
                    }}
                    className="flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-[14px] hover:bg-mist"
                  >
                    <Icon size={17} /> {label}
                  </button>
                ))}
                <span className="mx-2 my-1 h-px bg-line" />
                <span className="px-2.5 pt-0.5 pb-1 text-[12px] text-ink-3">Фон листа</span>
                <div className="grid grid-cols-4 gap-1 px-1 pb-0.5">
                  {(
                    [
                      ['grid', 'Клетка', Grid3x3],
                      ['lines', 'Линейка', Rows3],
                      ['dots', 'Точки', Grip],
                      ['plain', 'Чистый', Square],
                    ] as const
                  ).map(([bg, label, Icon]) => (
                    <button
                      key={bg}
                      type="button"
                      title={label}
                      aria-label={label}
                      onClick={() => setBg(bg)}
                      className={`grid h-10 place-items-center rounded-lg ${page?.bg === bg ? 'bg-tint text-brand-800' : 'text-ink-2 hover:bg-mist'}`}
                    >
                      <Icon size={17} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {canDraw && !compact && (
          <>
            <span className="mx-0.5 h-6 w-px bg-line" />
            <ToolButton title="Новый лист" onClick={addPage}>
              <Plus size={19} />
            </ToolButton>
            <div className="relative">
              <ToolButton title="Фон листа" onClick={() => setMenu(menu === 'bg' ? null : 'bg')}>
                <Grid3x3 size={19} />
              </ToolButton>
              {menu === 'bg' && (
                <div className={`absolute z-20 grid w-44 gap-0.5 rounded-xl bg-white p-1.5 shadow-lift ${compact ? 'top-12 left-0' : 'bottom-12 left-1/2 -translate-x-1/2'}`}>
                  {(
                    [
                      ['grid', 'Клетка', Grid3x3],
                      ['lines', 'Линейка', Rows3],
                      ['dots', 'Точки', Grip],
                      ['plain', 'Чистый', Square],
                    ] as const
                  ).map(([bg, label, Icon]) => (
                    <button
                      key={bg}
                      type="button"
                      onClick={() => setBg(bg)}
                      className={`flex h-9 items-center gap-2 rounded-lg px-2.5 text-[14px] ${page?.bg === bg ? 'bg-tint text-brand-800' : 'hover:bg-mist'}`}
                    >
                      <Icon size={16} /> {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ToolButton title="Загрузить PDF или презентацию (PDF)" onClick={() => pdfRef.current?.click()}>
              <FileUp size={19} />
            </ToolButton>
            {pages.length > 1 && (
              <ToolButton title="Удалить лист" onClick={deletePage}>
                <Trash2 size={18} />
              </ToolButton>
            )}
          </>
        )}
      </div>

      {/* Масштаб и режимы ведущего */}
      <div data-ui className={`absolute top-2 right-2 z-10 flex gap-1.5 sm:top-3 sm:right-3 ${tiny ? 'flex-col items-end' : 'items-center'}`}>
        {me.isHost && room && (
          <div className="flex items-center gap-0.5 rounded-2xl bg-white p-1 shadow-lift">
            <button
              type="button"
              onClick={() => page && sync.setFollow(!sync.follow.on, page.id)}
              className={`flex h-10 items-center gap-1.5 rounded-[11px] px-3 text-[14px] font-medium ${sync.follow.on ? 'bg-brand text-white' : 'text-ink-2 hover:bg-tint'}`}
              title="Ученики видят тот же лист, что и вы"
            >
              <Users size={17} /> <span className={compact ? 'hidden' : ''}>Все за мной</span>
            </button>
            <button
              type="button"
              onClick={() => sync.setPerm(!sync.perm.draw)}
              className={`flex h-10 items-center gap-1.5 rounded-[11px] px-3 text-[14px] font-medium ${sync.perm.draw ? 'text-ink-2 hover:bg-tint' : 'bg-accent-soft text-accent-600'}`}
              title={sync.perm.draw ? 'Ученики могут рисовать — нажмите, чтобы запретить' : 'Рисует только репетитор — нажмите, чтобы разрешить'}
            >
              <PenLine size={17} /> <span className={compact ? 'hidden' : ''}>{sync.perm.draw ? 'Ученики рисуют' : 'Только я рисую'}</span>
            </button>
          </div>
        )}
        <div className="flex items-center gap-0.5 rounded-2xl bg-white p-1 shadow-lift">
          {!compact && (
            <ToolButton title="Уменьшить" onClick={() => zoomAt(1 / 1.2, size.w / 2, size.h / 2)}>
              <Minus size={18} />
            </ToolButton>
          )}
          <button type="button" onClick={fit} title="Вписать лист" className="h-10 min-w-[52px] rounded-[11px] px-1 font-mono text-[12px] text-ink-2 hover:bg-tint">
            {Math.round(k * 100)}%
          </button>
          {!compact && (
            <ToolButton title="Увеличить" onClick={() => zoomAt(1.2, size.w / 2, size.h / 2)}>
              <Plus size={18} />
            </ToolButton>
          )}
          {!compact && (
            <ToolButton title="Вписать лист в экран" onClick={fit}>
              <Maximize2 size={17} />
            </ToolButton>
          )}
        </div>
      </div>

      {/* Статусы */}
      <div className="pointer-events-none absolute top-16 left-1/2 z-10 grid -translate-x-1/2 justify-items-center gap-2 sm:top-3">
        {followLocked && <span className="rounded-full bg-brand px-3 py-1.5 text-[13px] font-medium text-white shadow-soft">Репетитор ведёт урок — вы на его листе</span>}
        {!canDraw && <span className="rounded-full bg-white px-3 py-1.5 text-[13px] text-ink-2 shadow-soft">Сейчас рисует только репетитор</span>}
        {busy && (
          <span className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[13px] text-ink-2 shadow-soft">
            <LoaderCircle size={15} className="animate-spin" /> {busy}
          </span>
        )}
        {error && (
          <button type="button" className="pointer-events-auto rounded-full bg-danger-soft px-3 py-1.5 text-[13px] text-danger-600 shadow-soft" onClick={() => setError('')}>
            {error} ✕
          </button>
        )}
      </div>

      {!sync.loaded && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-[#f1f6f3]">
          <span className="flex items-center gap-2 text-ink-2">
            <LoaderCircle className="animate-spin" size={20} /> Загружаем доску…
          </span>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (onImage(e.target.files?.[0]), (e.target.value = ''))} />
      <input ref={pdfRef} type="file" accept="application/pdf" hidden onChange={(e) => (onPdf(e.target.files?.[0]), (e.target.value = ''))} />
      {modal === 'formula' && <FormulaModal onClose={() => setModal(null)} onInsert={insertFormula} />}
      {modal === 'graph' && <GraphModal onClose={() => setModal(null)} onInsert={insertGraph} />}
    </div>
  );
}
