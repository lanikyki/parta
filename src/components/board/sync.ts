'use client';

import { type Room, RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type BoardSnapshot, type Item, type Page, emptyBoard, mergeInto, sanitizeSnapshot } from '@/lib/board/types';

let lastV = 0;
/** Монотонная версия изменений (время + защита от расхождения часов). */
export const nextV = () => (lastV = Math.max(Date.now(), lastV + 1));

export class BoardStore {
  snap: BoardSnapshot = emptyBoard();
  version = 0;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  merge(patch: Partial<BoardSnapshot>) {
    for (const it of Object.values(patch.items ?? {})) if (it.v > lastV) lastV = it.v;
    for (const p of Object.values(patch.pages ?? {})) if (p.v > lastV) lastV = p.v;
    if (!mergeInto(this.snap, patch)) return false;
    this.version++;
    this.listeners.forEach((f) => f());
    return true;
  }
}

export type Me = { identity: string; name: string; isHost: boolean };
export type Laser = { x: number; y: number; page: string; name: string; t: number };
type Msg =
  | { k: 'ops'; items?: Item[]; pages?: Page[] }
  | { k: 'hello' }
  | { k: 'snap'; data: BoardSnapshot; follow?: Follow; perm?: Perm }
  | { k: 'live'; it: Item }
  | { k: 'laser'; x: number; y: number; page: string; name: string }
  | { k: 'follow'; on: boolean; page: string }
  | { k: 'perm'; draw: boolean };
type Follow = { on: boolean; page: string };
type Perm = { draw: boolean };

const enc = new TextEncoder();
const dec = new TextDecoder();
const byId = <T extends { id: string }>(list: T[] = []) => Object.fromEntries(list.map((x) => [x.id, x]));

/** Временные данные (чужие штрихи в процессе рисования и лазеры) — отдельно, чтобы не перерисовывать доску. */
class LiveStore {
  strokes = new Map<string, { it: Item; t: number }>();
  lasers = new Map<string, Laser>();
  version = 0;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  bump() {
    this.version++;
    this.listeners.forEach((f) => f());
  }
}

function isHostMeta(metadata?: string) {
  try {
    return JSON.parse(metadata || '{}').role === 'host';
  } catch {
    return false;
  }
}

export function useBoardSync({ code, room, me, store }: { code: string; room: Room | null; me: Me; store: BoardStore }) {
  const [loaded, setLoaded] = useState(false);
  const [follow, setFollowState] = useState<Follow>({ on: false, page: '' });
  const [perm, setPermState] = useState<Perm>({ draw: true });
  const live = useRef(new LiveStore()).current;
  const liveVersion = useSyncExternalStore(live.subscribe, live.getVersion, live.getVersion);
  const followRef = useRef(follow);
  const permRef = useRef(perm);
  followRef.current = follow;
  permRef.current = perm;

  const pending = useRef({ items: new Map<string, Item>(), pages: new Map<string, Page>() });
  const queue = useCallback((items: Item[] = [], pages: Page[] = []) => {
    for (const it of items) pending.current.items.set(it.id, it);
    for (const p of pages) pending.current.pages.set(p.id, p);
  }, []);

  const publish = useCallback(
    (msg: Msg, opts: { reliable?: boolean; to?: string[] } = {}) => {
      if (!room || room.state !== 'connected') return;
      const json = JSON.stringify(msg);
      const bytes = enc.encode(json);
      const lp = room.localParticipant;
      const reliable = opts.reliable !== false;
      if (!reliable) {
        if (bytes.length < 12_000) lp.publishData(bytes, { reliable: false, topic: 'board', destinationIdentities: opts.to }).catch(() => {});
        return;
      }
      if (bytes.length < 14_000) lp.publishData(bytes, { reliable: true, topic: 'board', destinationIdentities: opts.to }).catch(() => {});
      else lp.sendText(json, { topic: 'board-big', destinationIdentities: opts.to }).catch(() => {});
    },
    [room],
  );

  // Первичная загрузка с сервера
  useEffect(() => {
    let alive = true;
    fetch(`/api/lessons/${code}/board`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        if (data) store.merge(sanitizeSnapshot(data));
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [code, store]);

  // Сохранение изменений на сервер
  useEffect(() => {
    const url = `/api/lessons/${code}/board`;
    const take = () => {
      const { items, pages } = pending.current;
      if (!items.size && !pages.size) return null;
      const body = JSON.stringify({ items: [...items.values()], pages: [...pages.values()] });
      pending.current = { items: new Map(), pages: new Map() };
      return body;
    };
    const flush = async () => {
      const body = take();
      if (!body) return;
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        const back = JSON.parse(body) as { items: Item[]; pages: Page[] };
        for (const it of back.items) if (!pending.current.items.has(it.id)) pending.current.items.set(it.id, it);
        for (const p of back.pages) if (!pending.current.pages.has(p.id)) pending.current.pages.set(p.id, p);
      }
    };
    const timer = setInterval(flush, 1500);
    const onHide = () => {
      const body = take();
      if (body) navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, [code]);

  // Приём сообщений
  useEffect(() => {
    if (!room) return;
    const hostPresent = (except?: string) =>
      [...room.remoteParticipants.values()].some((p) => p.identity !== except && isHostMeta(p.metadata));
    const isHost = (identity: string) => isHostMeta(room.remoteParticipants.get(identity)?.metadata);
    const amResponder = (from: string) => {
      if (me.isHost) return true;
      if (hostPresent(from)) return false;
      const ids = [me.identity, ...[...room.remoteParticipants.keys()].filter((id) => id !== from)].sort();
      return ids[0] === me.identity;
    };
    const handle = (msg: Msg, from: string) => {
      switch (msg.k) {
        case 'ops': {
          store.merge({ items: byId(msg.items), pages: byId(msg.pages) });
          let changed = false;
          for (const it of msg.items ?? []) changed = live.strokes.delete(it.id) || changed;
          if (changed) live.bump();
          if (me.isHost) queue(msg.items, msg.pages);
          break;
        }
        case 'hello':
          if (amResponder(from))
            publish(
              { k: 'snap', data: store.snap, follow: me.isHost ? followRef.current : undefined, perm: me.isHost ? permRef.current : undefined },
              { to: [from] },
            );
          break;
        case 'snap':
          store.merge(sanitizeSnapshot(msg.data));
          if (msg.follow && isHost(from)) setFollowState(msg.follow);
          if (msg.perm && isHost(from)) setPermState(msg.perm);
          break;
        case 'live':
          live.strokes.set(msg.it.id, { it: msg.it, t: Date.now() });
          live.bump();
          break;
        case 'laser':
          live.lasers.set(from, { x: msg.x, y: msg.y, page: msg.page, name: msg.name, t: Date.now() });
          live.bump();
          break;
        case 'follow':
          if (isHost(from)) setFollowState({ on: msg.on, page: msg.page });
          break;
        case 'perm':
          if (isHost(from)) setPermState({ draw: msg.draw });
          break;
      }
    };
    const onData = (payload: Uint8Array, participant?: { identity: string }, _kind?: unknown, topic?: string) => {
      if (topic !== 'board' || !participant) return;
      try {
        handle(JSON.parse(dec.decode(payload)) as Msg, participant.identity);
      } catch {
        /* повреждённое сообщение — пропускаем */
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    try {
      room.registerTextStreamHandler('board-big', async (reader, info) => {
        try {
          handle(JSON.parse(await reader.readAll()) as Msg, info.identity);
        } catch {
          /* пропускаем */
        }
      });
    } catch {
      /* уже зарегистрирован */
    }
    const hello = () => publish({ k: 'hello' });
    if (room.state === 'connected') hello();
    else room.once(RoomEvent.Connected, hello);
    const sweep = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, s] of live.strokes) if (now - s.t > 6000) changed = live.strokes.delete(id) || changed;
      for (const [id, l] of live.lasers) if (now - l.t > 1500) changed = live.lasers.delete(id) || changed;
      if (changed) live.bump();
    }, 500);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.Connected, hello);
      try {
        room.unregisterTextStreamHandler('board-big');
      } catch {
        /* нет обработчика */
      }
      clearInterval(sweep);
    };
  }, [room, me.isHost, me.identity, store, publish, queue, live]);

  /** Применить свои изменения: локально, всем участникам и на сервер. */
  const commit = useCallback(
    (items: Item[], pages: Page[] = []) => {
      if (!items.length && !pages.length) return;
      store.merge({ items: byId(items), pages: byId(pages) });
      queue(items, pages);
      publish({ k: 'ops', items, pages });
    },
    [store, queue, publish],
  );

  const sendLive = useCallback((it: Item) => publish({ k: 'live', it }, { reliable: false }), [publish]);
  const sendLaser = useCallback(
    (x: number, y: number, page: string) => publish({ k: 'laser', x, y, page, name: me.name }, { reliable: false }),
    [publish, me.name],
  );
  const setFollow = useCallback(
    (on: boolean, page: string) => {
      setFollowState({ on, page });
      publish({ k: 'follow', on, page });
    },
    [publish],
  );
  const setPerm = useCallback(
    (draw: boolean) => {
      setPermState({ draw });
      publish({ k: 'perm', draw });
    },
    [publish],
  );

  return { loaded, commit, sendLive, sendLaser, follow, setFollow, perm, setPerm, live, liveVersion };
}
