'use client';

import {
  type TrackReference,
  type TrackReferenceOrPlaceholder,
  VideoTrack,
  isTrackReference,
  useConnectionState,
  useIsMuted,
  useIsSpeaking,
  useMaybeRoomContext,
  useMediaDeviceSelect,
  useParticipants,
  useRoomContext,
  useTrackToggle,
  useTracks,
} from '@livekit/components-react';
import { ConnectionState, type Participant, type RemoteParticipant, type Room, RoomEvent, Track } from 'livekit-client';
import {
  Check,
  Ellipsis,
  Link2,
  LoaderCircle,
  Lock,
  LogOut,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  PenLine,
  ScreenShare,
  ScreenShareOff,
  SendHorizontal,
  Settings,
  Sparkles,
  UserX,
  Users,
  Video,
  VideoOff,
  WifiOff,
  X,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogoMark } from '@/components/Logo';
import { formatSec, useElapsed as useWaitSec } from '@/components/app/useElapsed';
import { Board } from '@/components/board/Board';
import type { Me } from '@/components/board/sync';
import { renderMarkdown, renderMathText } from '@/lib/mathtext';
import { shareOrigin, usePublicOrigin } from '@/lib/publicOrigin';
import { mediaErrorText } from './devices';
import type { LessonInfo } from './LessonClient';

type Props = { lesson: LessonInfo; me: Me; ai: boolean; notice?: string; onLeave: () => void };
type Msg = { id: string; author: string; text: string; t: number; mine: boolean; old?: boolean };
type Toggle = { toggle: (force?: boolean) => unknown; enabled: boolean; pending: boolean };
type Media = { mic: Toggle; cam: Toggle; screen: Toggle; canShare: boolean };
type ShellProps = Props & {
  room: Room | null;
  media: Media | null;
  tiles: ((o: { hidden: boolean; onInvite: () => void; onFocus: (identity: string) => void }) => ReactNode) | null;
  /** Видео одного участника крупно — на месте доски */
  focusView?: (identity: string, onClose: () => void) => ReactNode;
  people: ReactNode | null;
  peopleCount: number;
  share: TrackReference | null;
  reconnecting: boolean;
  toast: string;
  showToast: (t: string) => void;
};

/* ───────── Вспомогательное ───────── */

const AVATAR_COLORS = ['#12a566', '#ff5a5f', '#2f6bff', '#7c4dff', '#ff8a00'];
function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';
function isHostP(p: Participant) {
  try {
    return JSON.parse(p.metadata || '{}').role === 'host';
  } catch {
    return false;
  }
}
const rank = (p: Participant) => (isHostP(p) ? 0 : p.isLocal ? 1 : 2);
const byRank = (a: Participant, b: Participant) =>
  rank(a) - rank(b) || (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0);
/** Служебные сообщения репетитора участникам (например, «репетитор выключил вам микрофон») */
const MOD_TOPIC = 'parta-mod';
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const fmtTime = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function fmtDur(s: number) {
  const p = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}
const mdCache = new Map<string, string>();
function md(m: Msg) {
  let html = mdCache.get(m.id);
  if (html === undefined) {
    html = renderMarkdown(m.text);
    // Кэш не растёт бесконечно на долгом уроке: старые записи выбрасываем
    if (mdCache.size > 600) mdCache.delete(mdCache.keys().next().value!);
    mdCache.set(m.id, html);
  }
  return html;
}

function useIsDesktop() {
  const [v, setV] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setV(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return v;
}

function useElapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return s;
}

function useToast() {
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((t: string) => {
    setToast(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), Math.max(2800, t.length * 60));
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show] as const;
}

function useCanShareScreen() {
  const [v, setV] = useState(false);
  useEffect(() => {
    setV(Boolean(navigator.mediaDevices?.getDisplayMedia) && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);
  return v;
}

/* ───────── Чат: LiveKit для мгновенной доставки + сервер для истории ───────── */

function useLessonChat(code: string, room: Room | null, me: Me) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const myName = me.name;

  const merge = useCallback((list: Msg[], atStart = false) => {
    setMsgs((cur) => {
      const ids = new Set(cur.map((m) => m.id));
      const fresh = list.filter((m) => !ids.has(m.id));
      if (!fresh.length) return cur;
      return (atStart ? [...fresh, ...cur] : [...cur, ...fresh]).slice(-400);
    });
  }, []);

  const load = useCallback(
    async (initial: boolean) => {
      try {
        const res = await fetch(`/api/lessons/${code}/chat`, { cache: 'no-store' });
        if (!res.ok) return;
        const rows = (await res.json()) as { id: string; author: string; text: string; created_at: string }[];
        merge(
          rows.map((r) => ({
            id: r.id,
            author: r.author,
            text: r.text,
            t: new Date(r.created_at).getTime(),
            mine: r.author === myName,
            old: initial,
          })),
          initial,
        );
      } catch {
        /* нет сети — попробуем позже */
      }
    },
    [code, myName, merge],
  );

  useEffect(() => {
    load(true);
    if (room) return;
    // Без видеосервера чат обновляется опросом раз в 5 секунд
    const id = setInterval(() => load(false), 5000);
    return () => clearInterval(id);
  }, [load, room]);

  useEffect(() => {
    if (!room) return;
    const dec = new TextDecoder();
    const onData = (payload: Uint8Array, from?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== 'chat') return;
      try {
        const m = JSON.parse(dec.decode(payload)) as { id?: unknown; text?: unknown };
        if (typeof m.id !== 'string' || typeof m.text !== 'string') return;
        merge([
          {
            id: m.id.slice(0, 40),
            author: (from?.name || from?.identity || 'Гость').slice(0, 60),
            text: m.text.slice(0, 4000),
            t: Date.now(),
            mine: false,
          },
        ]);
      } catch {
        /* чужой формат — пропускаем */
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, merge]);

  const send = useCallback(
    (raw: string) => {
      const m: Msg = { id: rid(), author: myName, text: raw.slice(0, 4000), t: Date.now(), mine: true };
      merge([m]);
      if (room && room.state === ConnectionState.Connected)
        room.localParticipant
          .publishData(new TextEncoder().encode(JSON.stringify({ id: m.id, text: m.text })), { reliable: true, topic: 'chat' })
          .catch(() => {});
      fetch(`/api/lessons/${code}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: m.id, author: m.author, text: m.text }),
      }).catch(() => {});
    },
    [code, myName, merge, room],
  );

  return { msgs, send };
}

/* ───────── Видео ───────── */

function Tile({ trackRef, onFocus }: { trackRef: TrackReferenceOrPlaceholder; onFocus?: () => void }) {
  const p = trackRef.participant;
  const host = isHostP(p);
  const speaking = useIsSpeaking(p);
  const micMuted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const camMuted = useIsMuted(trackRef);
  const name = p.name || p.identity;
  const video = isTrackReference(trackRef) && !camMuted;

  return (
    <div className="@container group/tile relative aspect-video w-[calc(50%-4px)] shrink-0 overflow-hidden rounded-2xl bg-brand-950 sm:w-56 lg:w-auto">
      {video ? (
        <VideoTrack trackRef={trackRef} className={`h-full w-full object-cover ${p.isLocal ? '-scale-x-100' : ''}`} />
      ) : (
        <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_50%_40%,#0a6342,#062e20_70%)]">
          <span
            className="grid size-[24cqw] place-items-center rounded-full text-[9cqw] font-medium text-white"
            style={{ background: colorFor(p.identity) }}
          >
            {initials(name)}
          </span>
        </div>
      )}
      <span
        className={`pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_3px_var(--color-mint)] transition-opacity duration-200 ${
          speaking && !micMuted ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {host && (
        <span className="absolute top-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-brand-800">
          Репетитор
        </span>
      )}
      {video && onFocus && (
        <button
          type="button"
          onClick={onFocus}
          title="Развернуть видео"
          aria-label={`Развернуть видео: ${name}`}
          className="absolute top-1.5 right-1.5 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Maximize2 size={15} />
        </button>
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-full bg-black/45 py-1 pr-2.5 pl-2 text-[12px] leading-4 text-white backdrop-blur-sm">
        {micMuted ? <MicOff size={13} className="shrink-0 text-[#ff9aa0]" /> : <Mic size={13} className="shrink-0" />}
        <span className="truncate">
          {name}
          {p.isLocal ? ' · вы' : ''}
        </span>
      </span>
    </div>
  );
}

function WaitingTile({ onInvite }: { onInvite: () => void }) {
  return (
    <button
      type="button"
      onClick={onInvite}
      className="group grid aspect-video w-[calc(50%-4px)] shrink-0 place-items-center sm:w-56 rounded-2xl border-[1.5px] border-dashed border-line-2 bg-white text-center transition-colors hover:border-brand hover:bg-tint lg:w-auto"
    >
      <span className="px-3">
        <span className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-tint text-brand transition-colors group-hover:bg-white">
          <Link2 size={17} />
        </span>
        <span className="mt-2 block text-[13px] leading-snug text-ink-2">
          Пока никого нет.
          <span className="block font-medium text-brand-700">Скопировать ссылку</span>
        </span>
      </span>
    </button>
  );
}

function Tiles({ hidden, onInvite, onFocus }: { hidden: boolean; onInvite: () => void; onFocus: (identity: string) => void }) {
  const cams = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const sorted = useMemo(() => [...cams].sort((a, b) => byRank(a.participant, b.participant)), [cams]);
  return (
    <section
      aria-label="Видео участников"
      className={`${hidden ? 'hidden' : 'flex'} gap-2 overflow-x-auto px-2 pb-2 [grid-area:tiles] lg:grid lg:overflow-visible lg:px-0 lg:pr-3 lg:pb-0 ${
        sorted.length > 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-1'
      }`}
    >
      {sorted.map((t) => (
        <Tile key={`${t.participant.identity}-${t.source}`} trackRef={t} onFocus={() => onFocus(t.participant.identity)} />
      ))}
      {sorted.length < 2 && <WaitingTile onInvite={onInvite} />}
    </section>
  );
}

type Moderation = { locked: boolean; removed: { who: string; name: string }[] };

/** Окно подтверждения поверх урока. */
function ConfirmModal({
  title,
  text,
  action,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  action: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-ink/40 p-3 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="pop-in w-full max-w-[440px] rounded-[24px] bg-white p-6 shadow-lift">
        <h2 id="confirm-title" className="text-[20px] leading-tight font-medium">
          {title}
        </h2>
        <p className="mt-2 text-[15px] text-ink-2">{text}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn btn-line btn-sm" onClick={onClose} autoFocus>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-sm bg-danger text-white hover:bg-[#d23c41]"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : <UserX size={16} />}
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}

function People({
  participants,
  me,
  code,
  room,
  showToast,
}: {
  participants: Participant[];
  me: Me;
  code: string;
  room: Room;
  showToast: (t: string) => void;
}) {
  const list = [...participants].sort(byRank);
  const host = me.isHost;
  const [mod, setMod] = useState<Moderation | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ identity: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!host) return;
    let off = false;
    fetch(`/api/lessons/${code}/people`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !off && d && setMod(d))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [host, code]);

  const act = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/lessons/${code}/people`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(out.error || 'Не получилось — попробуйте ещё раз');
        return false;
      }
      if (typeof out.locked === 'boolean') setMod(out);
      return true;
    } catch {
      showToast('Нет связи с сервером — попробуйте ещё раз');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const mute = async (p: Participant) => {
    setMenu(null);
    if (!(await act({ action: 'mute', identity: p.identity }))) return;
    showToast(`Микрофон выключен: ${p.name || p.identity}`);
    // Объясняем участнику, почему выключился микрофон
    room.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify({ type: 'muted' })), {
        reliable: true,
        destinationIdentities: [p.identity],
        topic: MOD_TOPIC,
      })
      .catch(() => {});
  };

  const remove = async () => {
    if (!confirm) return;
    if (await act({ action: 'remove', identity: confirm.identity })) showToast(`${confirm.name} больше не в уроке`);
    setConfirm(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {host && (
        <label className="flex cursor-pointer items-start gap-3 border-b border-line px-4.5 py-3">
          <input
            type="checkbox"
            className="mt-1 h-4.5 w-4.5 shrink-0 accent-[var(--color-brand)]"
            checked={Boolean(mod?.locked)}
            disabled={!mod || busy}
            onChange={async (e) => {
              const locked = e.target.checked;
              setMod((m) => m && { ...m, locked }); // переключатель срабатывает сразу, не дожидаясь сервера
              if (await act({ action: 'lock', locked }))
                showToast(locked ? 'Вход закрыт: новые люди не смогут зайти в урок' : 'Вход открыт: зайти можно по ссылке');
              else setMod((m) => m && { ...m, locked: !locked });
            }}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[15px]">
              <Lock size={14} className="text-ink-3" /> Закрыть вход в урок
            </span>
            <span className="block text-[12px] leading-snug text-ink-3">Новые люди не смогут зайти по ссылке. Кто уже был на уроке — сможет вернуться.</span>
          </span>
        </label>
      )}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {list.map((p) => {
          const name = p.name || p.identity;
          const manage = host && !p.isLocal && !isHostP(p);
          return (
            <li key={p.identity} className="relative flex items-center gap-3 rounded-xl px-2.5 py-2">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-medium text-white"
                style={{ background: colorFor(p.identity) }}
              >
                {initials(name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]">
                  {name}
                  {p.isLocal && <span className="text-ink-3"> · вы</span>}
                </span>
                <span className="block text-[12px] text-ink-3">{isHostP(p) ? 'Репетитор' : 'Участник'}</span>
              </span>
              {p.isMicrophoneEnabled ? <Mic size={16} className="text-ink-3" /> : <MicOff size={16} className="text-danger" />}
              {p.isCameraEnabled ? <Video size={16} className="text-ink-3" /> : <VideoOff size={16} className="text-danger" />}
              {manage && (
                <button
                  type="button"
                  onClick={() => setMenu((m) => (m === p.identity ? null : p.identity))}
                  aria-label={`Действия: ${name}`}
                  aria-expanded={menu === p.identity}
                  className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-mist"
                >
                  <Ellipsis size={18} />
                </button>
              )}
              {manage && menu === p.identity && (
                <>
                  <button type="button" aria-label="Закрыть меню" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenu(null)} />
                  <div role="menu" aria-label={`Действия: ${name}`} className="pop-in absolute top-12 right-1 z-50 grid w-56 gap-0.5 rounded-2xl bg-white p-1.5 shadow-lift">
                    <MenuItem role="menuitem" icon={<MicOff size={18} />} onClick={() => mute(p)} disabled={!p.isMicrophoneEnabled || busy}>
                      {p.isMicrophoneEnabled ? 'Выключить микрофон' : 'Микрофон выключен'}
                    </MenuItem>
                    <MenuItem
                      role="menuitem"
                      icon={<UserX size={18} className="text-danger" />}
                      onClick={() => (setMenu(null), setConfirm({ identity: p.identity, name }))}
                      disabled={busy}
                      danger
                    >
                      Удалить из урока
                    </MenuItem>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {host && mod && mod.removed.length > 0 && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-line p-2">
          <p className="px-2.5 pt-1 pb-1 text-[12px] font-medium text-ink-3">Удалённые из урока · {mod.removed.length}</p>
          {mod.removed.map((r) => (
            <div key={r.who} className="flex items-center gap-3 rounded-xl px-2.5 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[15px] text-ink-2">{r.name}</span>
              <button
                type="button"
                className="btn btn-line btn-sm shrink-0"
                disabled={busy}
                aria-label={`Вернуть в урок: ${r.name}`}
                onClick={async () => {
                  if (await act({ action: 'restore', who: r.who })) showToast(`${r.name} снова может зайти в урок`);
                }}
              >
                Вернуть
              </button>
            </div>
          ))}
        </div>
      )}
      {confirm && (
        <ConfirmModal
          title={`Удалить из урока: ${confirm.name}?`}
          text="Участник сразу выйдет из урока и не сможет вернуться по ссылке с того же аккаунта или устройства. Передумаете — нажмите «Вернуть» внизу списка. Чтобы не зашёл никто новый, закройте вход в урок."
          action="Удалить"
          busy={busy}
          onConfirm={remove}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/** Видео одного участника крупно (например, чтобы разглядеть тетрадь у камеры). */
function FocusView({ identity, onClose }: { identity: string; onClose: () => void }) {
  const room = useRoomContext();
  const cams = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const ref = cams.find((t) => t.participant.identity === identity);
  const p = ref?.participant ?? room.getParticipantByIdentity(identity);
  const live = ref && isTrackReference(ref) && !ref.publication.isMuted;
  // Участник вышел — возвращаемся к доске
  useEffect(() => {
    if (!room.getParticipantByIdentity(identity)) return onClose();
    const on = (left: Participant) => left.identity === identity && onClose();
    room.on(RoomEvent.ParticipantDisconnected, on);
    return () => {
      room.off(RoomEvent.ParticipantDisconnected, on);
    };
  }, [room, identity, onClose]);
  if (!p) return null;
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-[#071a13]">
      {live ? (
        <VideoTrack trackRef={ref} className={`h-full w-full object-contain ${p.isLocal ? '-scale-x-100' : ''}`} />
      ) : (
        <p className="px-6 text-center text-[15px] text-white/70">Камера выключена</p>
      )}
      <span className="absolute top-3 left-3 max-w-[calc(100%-150px)] truncate rounded-full bg-white/10 px-3 py-1.5 text-[13px] text-white backdrop-blur">
        Видео · {p.name || p.identity}
        {p.isLocal ? ' · вы' : ''}
      </span>
      <button type="button" onClick={onClose} className="btn btn-glass btn-sm absolute top-3 right-3">
        <Minimize2 size={16} /> Свернуть
      </button>
    </div>
  );
}

/** Выбор микрофона, камеры и динамиков. */
function DeviceSelect({ kind, label, room }: { kind: MediaDeviceKind; label: string; room: Room }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind, room });
  const [error, setError] = useState('');
  const list = devices.filter((d) => d.deviceId);
  return (
    <label className="field">
      {label}
      {list.length ? (
        <select
          className="input"
          value={list.some((d) => d.deviceId === activeDeviceId) ? activeDeviceId : list[0].deviceId}
          onChange={(e) => {
            setError('');
            setActiveMediaDevice(e.target.value).catch((err) => setError(mediaErrorText(err, kind === 'videoinput' ? 'cam' : 'mic')));
          }}
        >
          {list.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-[14px] font-normal text-ink-3">
          {kind === 'audiooutput' ? 'Этот браузер не даёт выбрать динамики — звук идёт туда же, куда и у других программ.' : 'Не найдено'}
        </span>
      )}
      {error && <span className="text-[14px] font-normal text-danger-600">{error}</span>}
    </label>
  );
}

function DevicesModal({ room, onClose }: { room: Room; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 p-3 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="devices-title" className="pop-in w-full max-w-[480px] rounded-[24px] bg-white p-6 shadow-lift">
        <div className="flex items-start gap-3">
          <h2 id="devices-title" className="flex-1 text-[20px] leading-tight font-medium">
            Звук и видео
          </h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="-mt-1 -mr-2 grid h-9 w-9 place-items-center rounded-full text-ink-2 hover:bg-mist">
            <X size={18} />
          </button>
        </div>
        <div className="mt-4 grid gap-4">
          <DeviceSelect kind="audioinput" label="Микрофон" room={room} />
          <DeviceSelect kind="audiooutput" label="Динамики" room={room} />
          <DeviceSelect kind="videoinput" label="Камера" room={room} />
        </div>
        <p className="mt-4 rounded-xl bg-mist px-4 py-3 text-[14px] text-ink-2">
          Вас плохо слышно или слышно эхо — подключите наушники с микрофоном и выберите их здесь. Видео тормозит — закройте лишние вкладки и программы
          (торренты, обновления), а если вы в VPN — выключите его.
        </p>
      </div>
    </div>
  );
}

function ScreenView({ share, onStop }: { share: TrackReference; onStop: () => void }) {
  const p = share.participant;
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-[#071a13]">
      {p.isLocal ? (
        <div className="px-6 text-center text-white">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/10">
            <MonitorUp size={28} />
          </span>
          <p className="mt-4 text-[20px] font-medium">Вы показываете экран</p>
          <p className="mx-auto mt-1 max-w-[340px] text-[15px] text-white/60">Участники видят ваш экран. Доска никуда не денется.</p>
          <button type="button" className="btn btn-accent mt-6" onClick={onStop}>
            <ScreenShareOff size={18} /> Остановить показ
          </button>
        </div>
      ) : (
        <VideoTrack trackRef={share} className="h-full w-full object-contain" />
      )}
      <span className="absolute top-3 left-3 rounded-full bg-white/10 px-3 py-1.5 text-[13px] text-white backdrop-blur">
        Экран · {p.name || p.identity}
      </span>
    </div>
  );
}

/* ───────── Чат ───────── */

function ChatPanel({ msgs, onSend, active }: { msgs: Msg[]; onSend: (t: string) => void; active: boolean }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [msgs.length, active]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
    if (taRef.current) taRef.current.style.height = '';
  };

  return (
    <>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {msgs.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div className="max-w-[250px]">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-tint text-brand">
                <MessageCircle size={22} />
              </span>
              <p className="mt-3 text-[15px] font-medium">Чат урока</p>
              <p className="mt-1 text-[14px] leading-snug text-ink-3">
                Вопросы, ссылки и формулы. Формулу пишите между знаками $: например,{' '}
                <code className="rounded bg-mist px-1 font-mono text-[12px] text-ink-2">$x^2+1$</code> превратится в{' '}
                <span className="text-ink" dangerouslySetInnerHTML={{ __html: renderMathText('$x^2+1$') }} />.
              </p>
            </div>
          </div>
        ) : (
          msgs.map((m, i) => {
            const first = i === 0 || msgs[i - 1].author !== m.author || msgs[i - 1].mine !== m.mine;
            return (
              <div key={m.id} className={`flex flex-col ${m.mine ? 'items-end' : 'items-start'} ${i === 0 ? '' : first ? 'mt-3' : 'mt-1'}`}>
                {first && (
                  <span className="mb-1 px-1 text-[12px] text-ink-3">
                    {m.mine ? 'Вы' : m.author} · {fmtTime(m.t)}
                  </span>
                )}
                <div
                  className={`prose-chat max-w-[88%] rounded-[18px] px-3.5 py-2 text-[15px] leading-normal [overflow-wrap:anywhere] ${
                    m.mine ? 'bubble-mine rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-mist text-ink'
                  }`}
                  dangerouslySetInnerHTML={{ __html: md(m) }}
                />
              </div>
            );
          })
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 border-t border-line p-3"
      >
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          maxLength={4000}
          aria-label="Сообщение в чат"
          placeholder="Сообщение…"
          onChange={(e) => {
            setText(e.target.value);
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight + 3, 132)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="input max-h-[132px] min-h-11 flex-1 resize-none py-2.5 text-[15px]"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Отправить"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-white transition hover:bg-brand-600 disabled:opacity-40"
        >
          <SendHorizontal size={18} />
        </button>
      </form>
    </>
  );
}

/* ───────── Итоги урока ───────── */

function SummaryModal({ code, ai, onClose, onSend }: { code: string; ai: boolean; onClose: () => void; onSend: (t: string) => void }) {
  const [notes, setNotes] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const sec = useWaitSec(state === 'busy');
  const html = useMemo(() => (summary ? renderMarkdown(summary) : ''), [summary]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run() {
    setState('busy');
    setError('');
    try {
      const res = await fetch(`/api/lessons/${code}/summary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      // Сервер, пока ИИ думает, шлёт пробелы — поэтому ошибка приходит в поле error даже при коде 200
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error || !out.summary) throw new Error(out.error || 'Не получилось составить конспект, попробуйте ещё раз');
      setSummary(String(out.summary));
      setSent(false);
      setState('done');
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 p-3 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="summary-title"
        className="pop-in flex max-h-[min(88dvh,760px)] w-full max-w-[620px] flex-col overflow-hidden rounded-[24px] bg-white shadow-lift"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-600">
            <Sparkles size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="summary-title" className="text-[20px] leading-tight font-medium">
              Итоги урока
            </h2>
            <p className="mt-0.5 text-[14px] text-ink-3">ИИ соберёт конспект и домашнее задание по доске и чату</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-mist hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {!ai ? (
            <div className="rounded-2xl bg-mist p-4 text-[15px] text-ink-2">
              ИИ-помощник ещё не подключён. Добавьте на сервере переменные <code className="font-mono text-[13px]">AI_BASE_URL</code> и{' '}
              <code className="font-mono text-[13px]">AI_API_KEY</code> — инструкция в README.
            </div>
          ) : state === 'done' ? (
            <div className="prose-chat text-[15px]" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <label className="field">
              <span>
                Заметки репетитора <span className="font-normal text-ink-3">— необязательно</span>
              </span>
              <textarea
                className="input"
                rows={5}
                value={notes}
                maxLength={3000}
                disabled={state === 'busy'}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Например: путает знаки при переносе через «=». Дома — № 214 и 216."
              />
            </label>
          )}
          {state === 'busy' && (
            <p className="mt-3 text-[13px] text-ink-3">
              ИИ читает доску и чат урока — обычно это занимает 1–2 минуты.{sec >= 3 ? ` Прошло ${formatSec(sec)}.` : ''}
            </p>
          )}
          {error && <p className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger-600">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">
          {state === 'done' ? (
            <>
              <span className="mr-auto flex items-center gap-1.5 text-[13px] text-mint">
                <Check size={15} /> Сохранено в кабинете
              </span>
              <button type="button" className="btn btn-line btn-sm" onClick={() => setState('idle')}>
                Заново
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={sent}
                onClick={() => {
                  onSend(summary);
                  setSent(true);
                }}
              >
                {sent ? 'Отправлено в чат' : 'Отправить в чат'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-line btn-sm" onClick={onClose}>
                Отмена
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={!ai || state === 'busy'}>
                {state === 'busy' ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {state === 'busy' ? 'Составляем…' : 'Составить конспект'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────── Кнопки ───────── */

function CtrlButton({
  label,
  onClick,
  children,
  off = false,
  on = false,
  disabled = false,
  badge = 0,
  text,
  className = '',
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  off?: boolean;
  on?: boolean;
  disabled?: boolean;
  badge?: number;
  text?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`relative flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-[14px] font-medium transition-colors disabled:opacity-50 ${
        off
          ? 'bg-danger text-white hover:bg-[#d23c41]'
          : on
            ? 'bg-brand text-white hover:bg-brand-600'
            : 'bg-white text-ink shadow-soft hover:bg-tint hover:text-brand-800'
      } ${className}`}
    >
      {children}
      {text && <span className="hidden pr-1 xl:inline">{text}</span>}
      {badge > 0 && (
        <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center gap-1.5 rounded-xl px-3 text-[14px] font-medium transition-colors ${
        active ? 'bg-tint text-brand-800' : 'text-ink-2 hover:bg-mist'
      }`}
    >
      {children}
    </button>
  );
}

/* ───────── Каркас комнаты ───────── */

function RoomShell(props: ShellProps) {
  const { lesson, me, ai, notice, onLeave, room, media, tiles, focusView, people, peopleCount, share, reconnecting, toast, showToast } = props;
  const desktop = useIsDesktop();
  const elapsed = useElapsed();
  const chat = useLessonChat(lesson.code, room, me);
  usePublicOrigin();
  const [tab, setTab] = useState<'chat' | 'people'>('chat');
  const [drawer, setDrawer] = useState(false);
  const [more, setMore] = useState(false);
  const [showTiles, setShowTiles] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [view, setView] = useState<'board' | 'screen'>('board');
  const [focus, setFocus] = useState<string | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(true);
  const closeFocus = useCallback(() => setFocus(null), []);

  useEffect(() => setNoticeOpen(true), [notice]);

  // Кто-то начал показ экрана — переключаемся на него, закончил — возвращаемся к доске
  const shareSid = share?.publication.trackSid;
  useEffect(() => {
    setView(shareSid ? 'screen' : 'board');
    if (shareSid) setFocus(null);
  }, [shareSid]);

  // Непрочитанные сообщения
  const chatVisible = tab === 'chat' && (desktop || drawer);
  const lastId = chat.msgs.at(-1)?.id ?? null;
  const [seenId, setSeenId] = useState<string | null>(null);
  useEffect(() => {
    if (chatVisible) setSeenId(lastId);
  }, [chatVisible, lastId]);
  const unread = useMemo(() => {
    if (chatVisible) return 0;
    const from = seenId ? chat.msgs.findIndex((m) => m.id === seenId) + 1 : 0;
    return chat.msgs.slice(from).filter((m) => !m.mine && !m.old).length;
  }, [chatVisible, seenId, chat.msgs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMore(false);
      setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const invite = useCallback(async () => {
    const url = `${shareOrigin()}/lesson/${lesson.code}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Ссылка на урок скопирована');
    } catch {
      window.prompt('Скопируйте ссылку на урок', url);
    }
  }, [lesson.code, showToast]);

  const leave = () => {
    if (room) room.disconnect().finally(onLeave);
    else onLeave();
  };

  const openPanel = (t: 'chat' | 'people') => {
    setTab(t);
    setDrawer(true);
    setMore(false);
  };

  return (
    <div className="room-grid bg-mist">
      {/* Верхняя панель */}
      <header className="flex h-14 min-w-0 items-center gap-3 px-3 [grid-area:top] lg:px-4">
        <LogoMark className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] leading-tight font-medium sm:text-[16px]">{lesson.title}</p>
          <p className="truncate text-[12px] leading-tight text-ink-3 sm:text-[13px]">
            {[lesson.subject, `репетитор ${lesson.tutor}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {share && (
          <div className="flex shrink-0 rounded-full bg-white p-1 shadow-soft">
            {(
              [
                ['board', 'Доска', PenLine],
                ['screen', 'Экран', MonitorUp],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                onClick={() => (setView(v), setFocus(null))}
                aria-pressed={view === v && !focus}
                className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${
                  view === v && !focus ? 'bg-brand text-white' : 'text-ink-2 hover:text-brand-800'
                }`}
              >
                <Icon size={15} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        )}
        <span className="flex shrink-0 items-center gap-2 rounded-full bg-white px-3 py-1.5 font-mono text-[12px] text-ink-2 shadow-soft">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
          <span className="tabular-nums">{fmtDur(elapsed)}</span>
        </span>
        <button type="button" onClick={invite} className="btn btn-soft btn-sm hidden shrink-0 sm:inline-flex">
          <Link2 size={16} /> Пригласить
        </button>
      </header>

      {/* Видео */}
      {tiles ? (
        tiles({ hidden: !showTiles && !desktop, onInvite: invite, onFocus: setFocus })
      ) : (
        <section className="hidden lg:block lg:pr-3 lg:[grid-area:tiles]">
          <div className="rounded-2xl border border-line bg-white p-4 text-[14px] leading-snug text-ink-2">
            <span className="mb-2 grid h-9 w-9 place-items-center rounded-xl bg-tint text-brand">
              <VideoOff size={18} />
            </span>
            Видеосвязь не подключена. Доска и чат работают и сохраняются.
          </div>
        </section>
      )}

      {/* Доска / экран */}
      <main className="relative min-h-0 [grid-area:main] lg:pl-3">
        <div className="relative h-full overflow-hidden border-y border-line bg-white lg:rounded-[20px] lg:border">
          <Board code={lesson.code} room={room} me={me} />
          {view === 'screen' && share && <ScreenView share={share} onStop={() => media?.screen.toggle(false)} />}
          {focus && focusView?.(focus, closeFocus)}
          {(reconnecting || (notice && noticeOpen)) && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-3">
              {reconnecting ? (
                <span className="pop-in flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[14px] text-white shadow-lift">
                  <WifiOff size={16} /> Связь прервалась — переподключаемся…
                </span>
              ) : (
                <span className="pop-in pointer-events-auto flex items-center gap-2 rounded-2xl bg-[#fff4cc] py-2 pr-2 pl-4 text-[14px] text-ink shadow-lift">
                  {notice}
                  <button
                    type="button"
                    onClick={() => setNoticeOpen(false)}
                    aria-label="Скрыть"
                    className="grid h-7 w-7 place-items-center rounded-full hover:bg-black/5"
                  >
                    <X size={15} />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Нижняя панель */}
      <footer className="relative flex h-16 items-center gap-2 bg-white px-3 [grid-area:bar] max-lg:border-t max-lg:border-line lg:bg-transparent lg:pr-0 lg:pl-3">
        <button
          type="button"
          onClick={invite}
          title="Скопировать ссылку на урок"
          className="hidden min-w-0 flex-1 items-center gap-2 text-left lg:flex"
        >
          <span className="font-mono text-[11px] tracking-wide text-ink-3 uppercase">Код</span>
          <span className="font-mono text-[13px] text-ink-2 hover:text-brand-700">{lesson.code}</span>
        </button>

        <div className="flex flex-1 items-center justify-start gap-2 lg:flex-none lg:justify-center">
          {media ? (
            <>
              <CtrlButton
                label={media.mic.enabled ? 'Выключить микрофон' : 'Включить микрофон'}
                text="Микрофон"
                off={!media.mic.enabled}
                disabled={media.mic.pending}
                onClick={() => media.mic.toggle()}
              >
                {media.mic.enabled ? <Mic size={19} /> : <MicOff size={19} />}
              </CtrlButton>
              <CtrlButton
                label={media.cam.enabled ? 'Выключить камеру' : 'Включить камеру'}
                text="Камера"
                off={!media.cam.enabled}
                disabled={media.cam.pending}
                onClick={() => media.cam.toggle()}
              >
                {media.cam.enabled ? <Video size={19} /> : <VideoOff size={19} />}
              </CtrlButton>
              {media.canShare && (
                <CtrlButton
                  label={media.screen.enabled ? 'Остановить показ экрана' : 'Показать экран'}
                  text={media.screen.enabled ? 'Остановить' : 'Экран'}
                  on={media.screen.enabled}
                  disabled={media.screen.pending}
                  onClick={() => media.screen.toggle()}
                  className="max-lg:hidden"
                >
                  {media.screen.enabled ? <ScreenShareOff size={19} /> : <ScreenShare size={19} />}
                </CtrlButton>
              )}
              <CtrlButton label="Звук и видео: выбрать микрофон, камеру и динамики" onClick={() => setDevicesOpen(true)} className="max-lg:hidden">
                <Settings size={19} />
              </CtrlButton>
            </>
          ) : (
            <span className="hidden rounded-full bg-white px-3 py-2 text-[13px] text-ink-3 shadow-soft lg:inline">Режим без видео</span>
          )}
          <CtrlButton label="Чат" badge={unread} onClick={() => openPanel('chat')} className="lg:hidden">
            <MessageCircle size={19} />
          </CtrlButton>
          <CtrlButton label="Ещё" on={more} onClick={() => setMore((v) => !v)} className="lg:hidden">
            <Ellipsis size={19} />
          </CtrlButton>
        </div>

        <div className="flex items-center justify-end gap-2 lg:flex-1">
          {me.isHost && (
            <CtrlButton label="Итоги урока" text="Итоги урока" onClick={() => setSummaryOpen(true)} className="max-lg:hidden">
              <Sparkles size={18} className="text-accent-600" />
            </CtrlButton>
          )}
          <button
            type="button"
            onClick={leave}
            aria-label="Выйти"
            title="Выйти из урока"
            className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-danger px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#d23c41] max-[359px]:px-3"
          >
            <LogOut size={18} /> <span className="max-[359px]:hidden">Выйти</span>
          </button>
        </div>

        {more && (
          <>
            <button type="button" aria-label="Закрыть меню" className="fixed inset-0 z-40 cursor-default lg:hidden" onClick={() => setMore(false)} />
            <div className="pop-in absolute right-3 bottom-[72px] z-50 grid w-60 gap-0.5 rounded-2xl bg-white p-1.5 shadow-lift lg:hidden">
              <MenuItem icon={<Link2 size={18} />} onClick={() => (setMore(false), invite())}>
                Пригласить по ссылке
              </MenuItem>
              {people && (
                <MenuItem icon={<Users size={18} />} onClick={() => openPanel('people')}>
                  Участники · {peopleCount}
                </MenuItem>
              )}
              {media && (
                <MenuItem icon={<Video size={18} />} onClick={() => (setShowTiles((v) => !v), setMore(false))}>
                  {showTiles ? 'Скрыть видео' : 'Показать видео'}
                </MenuItem>
              )}
              {media?.canShare && (
                <MenuItem icon={<ScreenShare size={18} />} onClick={() => (media.screen.toggle(), setMore(false))}>
                  {media.screen.enabled ? 'Остановить показ экрана' : 'Показать экран'}
                </MenuItem>
              )}
              {media && (
                <MenuItem icon={<Settings size={18} />} onClick={() => (setDevicesOpen(true), setMore(false))}>
                  Звук и видео
                </MenuItem>
              )}
              {me.isHost && (
                <MenuItem icon={<Sparkles size={18} className="text-accent-600" />} onClick={() => (setSummaryOpen(true), setMore(false))}>
                  Итоги урока
                </MenuItem>
              )}
            </div>
          </>
        )}
      </footer>

      {/* Чат и участники: сбоку на компьютере, на весь экран на телефоне */}
      <aside
        className={`${drawer ? 'fixed inset-0 z-50 flex' : 'hidden'} flex-col bg-white lg:static lg:z-auto lg:m-3 lg:mt-2 lg:ml-0 lg:flex lg:overflow-hidden lg:rounded-[20px] lg:border lg:border-line lg:[grid-area:side]`}
      >
        <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-2">
          <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>
            Чат
            {unread > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">{unread}</span>
            )}
          </TabButton>
          {people && (
            <TabButton active={tab === 'people'} onClick={() => setTab('people')}>
              Участники <span className="text-ink-3">{peopleCount}</span>
            </TabButton>
          )}
          <button
            type="button"
            onClick={() => setDrawer(false)}
            aria-label="Закрыть"
            className="ml-auto grid h-10 w-10 place-items-center rounded-full text-ink-2 hover:bg-mist lg:hidden"
          >
            <X size={20} />
          </button>
        </div>
        {tab === 'people' && people ? people : <ChatPanel msgs={chat.msgs} onSend={chat.send} active={chatVisible} />}
      </aside>

      {devicesOpen && room && <DevicesModal room={room} onClose={() => setDevicesOpen(false)} />}

      {summaryOpen && (
        <SummaryModal
          code={lesson.code}
          ai={ai}
          onClose={() => setSummaryOpen(false)}
          onSend={(t) => {
            chat.send(t);
            showToast('Конспект отправлен в чат');
          }}
        />
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex justify-center px-4 lg:bottom-6">
        {toast && <span className="pop-in max-w-[min(92vw,520px)] rounded-2xl bg-ink px-4 py-2.5 text-center text-[14px] text-white shadow-lift">{toast}</span>}
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  onClick,
  children,
  disabled = false,
  danger = false,
  role,
}: {
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  role?: 'menuitem';
}) {
  return (
    <button
      type="button"
      role={role}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-11 items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors hover:bg-mist disabled:opacity-50 disabled:hover:bg-transparent ${danger ? 'text-danger-600' : 'text-ink'}`}
    >
      <span className="text-ink-2">{icon}</span>
      {children}
    </button>
  );
}

/* ───────── Режимы: с видеосервером и без ───────── */

function LiveRoom(props: Props & { room: Room }) {
  const [toast, showToast] = useToast();
  const mic = useTrackToggle({ source: Track.Source.Microphone, onDeviceError: (e) => showToast(mediaErrorText(e, 'mic')) });
  const cam = useTrackToggle({ source: Track.Source.Camera, onDeviceError: (e) => showToast(mediaErrorText(e, 'cam')) });
  const screen = useTrackToggle({
    source: Track.Source.ScreenShare,
    onDeviceError: (e) => {
      if (e?.name !== 'NotAllowedError') showToast('Не удалось показать экран');
    },
  });
  const canShare = useCanShareScreen();
  const shares = useTracks([Track.Source.ScreenShare]);
  const share = useMemo(() => shares.filter(isTrackReference).at(-1) ?? null, [shares]);
  const participants = useParticipants();
  const state = useConnectionState();
  const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
  const { room } = props;

  // Репетитор выключил мне микрофон — объясняем, что произошло и как включить снова
  useEffect(() => {
    const on = (payload: Uint8Array, from?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== MOD_TOPIC || !from || !isHostP(from)) return;
      try {
        if (JSON.parse(new TextDecoder().decode(payload)).type === 'muted')
          showToast('Репетитор выключил вам микрофон. Чтобы говорить, включите его кнопкой «Микрофон».');
      } catch {}
    };
    room.on(RoomEvent.DataReceived, on);
    return () => {
      room.off(RoomEvent.DataReceived, on);
    };
  }, [room, showToast]);

  return (
    <RoomShell
      {...props}
      media={{ mic, cam, screen, canShare }}
      tiles={(o) => <Tiles {...o} />}
      focusView={(id, close) => <FocusView identity={id} onClose={close} />}
      people={<People participants={participants} me={props.me} code={props.lesson.code} room={room} showToast={showToast} />}
      peopleCount={participants.length}
      share={share}
      reconnecting={reconnecting}
      toast={toast}
      showToast={showToast}
    />
  );
}

function SoloRoom(props: Props) {
  const [toast, showToast] = useToast();
  return (
    <RoomShell
      {...props}
      room={null}
      media={null}
      tiles={null}
      people={null}
      peopleCount={1}
      share={null}
      reconnecting={false}
      toast={toast}
      showToast={showToast}
    />
  );
}

export function RoomUI(props: Props) {
  const room = useMaybeRoomContext();
  return room ? <LiveRoom {...props} room={room} /> : <SoloRoom {...props} />;
}
