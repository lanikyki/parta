'use client';

import type { Participant } from 'livekit-client';
import type { ReactNode } from 'react';

/* Общие мелочи комнаты урока: цвета и инициалы участников, кто репетитор, пункт меню. */

const AVATAR_COLORS = ['#12a566', '#ff5a5f', '#2f6bff', '#7c4dff', '#ff8a00'];
export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';
export function isHostP(p: Participant) {
  try {
    return JSON.parse(p.metadata || '{}').role === 'host';
  } catch {
    return false;
  }
}
const rank = (p: Participant) => (isHostP(p) ? 0 : p.isLocal ? 1 : 2);
export const byRank = (a: Participant, b: Participant) =>
  rank(a) - rank(b) || (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0);
/** Служебные сообщения репетитора участникам (например, «репетитор выключил вам микрофон») */
export const MOD_TOPIC = 'parta-mod';

export function MenuItem({
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
