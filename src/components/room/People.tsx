'use client';

import type { Participant, Room } from 'livekit-client';
import { Ellipsis, LoaderCircle, Lock, Mic, MicOff, UserX, Video, VideoOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Me } from '@/components/board/sync';
import { avatarOf, byRank, colorFor, initials, isHostP, MenuItem, MOD_TOPIC } from './parts';

export type Moderation = { locked: boolean; removed: { who: string; name: string }[] };

/** Окно подтверждения поверх урока. */
export function ConfirmModal({
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

export function People({
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
  const [menu, setMenu] = useState<{ identity: string; pos: { top?: number; bottom?: number; right: number } } | null>(null);
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
        showToast(out.error || 'Не получилось — попробуйте ещё раз');
        return false;
      }
      if (typeof out.locked === 'boolean') setMod(out);
      return true;
    } catch {
      showToast('Нет связи с сервером — попробуйте ещё раз');
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

  /** Меню «…» рисуем поверх всего: в списке его обрезал край панели, и на невысоком экране оно было не видно. Под кнопкой, а если внизу нет места — над ней. */
  const openMenu = (btn: HTMLElement, identity: string) => {
    if (menu?.identity === identity) return setMenu(null);
    const r = btn.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    const below = r.bottom + 6 + 112 <= window.innerHeight - 8;
    setMenu({ identity, pos: below ? { top: r.bottom + 6, right } : { bottom: Math.max(8, window.innerHeight - r.top + 6), right } });
  };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const remove = async () => {
    if (!confirm) return;
    if (await act({ action: 'remove', identity: confirm.identity })) showToast(`${confirm.name} больше не в уроке`);
    setConfirm(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {host && (
        <label
          className="flex cursor-pointer items-start gap-3 border-b border-line px-4.5 py-3 [@media(max-height:760px)]:py-2"
          title="Новые люди не смогут зайти по ссылке. Кто уже был на уроке — сможет вернуться."
        >
          <input
            type="checkbox"
            className="mt-1 h-4.5 w-4.5 shrink-0 accent-[var(--color-brand)]"
            checked={Boolean(mod?.locked)}
            disabled={!mod || busy}
            onChange={async (e) => {
              const locked = e.target.checked;
              setMod((m) => m && { ...m, locked }); // переключатель срабатывает сразу, не дожидаясь сервера
              if (await act({ action: 'lock', locked }))
                showToast(locked ? 'Вход закрыт: новые люди не смогут зайти в урок' : 'Вход открыт: зайти можно по ссылке');
              else setMod((m) => m && { ...m, locked: !locked });
            }}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[15px]">
              <Lock size={14} className="text-ink-3" /> Закрыть вход в урок
            </span>
            <span className="block text-[12px] leading-snug text-ink-3 [@media(max-height:760px)]:hidden">Новые люди не смогут зайти по ссылке. Кто уже был на уроке — сможет вернуться.</span>
          </span>
        </label>
      )}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {list.map((p) => {
          const name = p.name || p.identity;
          const manage = host && !p.isLocal && !isHostP(p);
          return (
            <li key={p.identity} className="relative flex items-center gap-3 rounded-xl px-2.5 py-2">
              {avatarOf(p) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarOf(p)!} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
              ) : (
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-medium text-white"
                  style={{ background: colorFor(p.identity) }}
                >
                  {initials(name)}
                </span>
              )}
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
                  onClick={(e) => openMenu(e.currentTarget, p.identity)}
                  aria-label={`Действия: ${name}`}
                  aria-expanded={menu?.identity === p.identity}
                  className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-mist"
                >
                  <Ellipsis size={18} />
                </button>
              )}
              {manage &&
                menu?.identity === p.identity &&
                createPortal(
                  <>
                    <button type="button" aria-label="Закрыть меню" className="fixed inset-0 z-[60] cursor-default" onClick={() => setMenu(null)} />
                    <div role="menu" aria-label={`Действия: ${name}`} style={menu.pos} className="pop-in fixed z-[61] grid w-56 gap-0.5 rounded-2xl bg-white p-1.5 shadow-lift">
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
                        Удалить из урока
                      </MenuItem>
                    </div>
                  </>,
                  document.body,
                )}
            </li>
          );
        })}
      </ul>
      {host && mod && mod.removed.length > 0 && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-line p-2">
          <p className="px-2.5 pt-1 pb-1 text-[12px] font-medium text-ink-3">Удалённые из урока · {mod.removed.length}</p>
          {mod.removed.map((r) => (
            <div key={r.who} className="flex items-center gap-3 rounded-xl px-2.5 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[15px] text-ink-2">{r.name}</span>
              <button
                type="button"
                className="btn btn-line btn-sm shrink-0"
                disabled={busy}
                aria-label={`Вернуть в урок: ${r.name}`}
                onClick={async () => {
                  if (await act({ action: 'restore', who: r.who })) showToast(`${r.name} снова может зайти в урок`);
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
          title={`Удалить из урока: ${confirm.name}?`}
          text="Участник сразу выйдет из урока и не сможет вернуться по ссылке с того же аккаунта или устройства. Передумаете — нажмите «Вернуть» внизу списка. Чтобы не зашёл никто новый, закройте вход в урок."
          action="Удалить"
          busy={busy}
          onConfirm={remove}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
