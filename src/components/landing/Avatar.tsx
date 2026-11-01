/** Простые иллюстрации «камеры» участников для макета урока. */
export function AvatarTutor({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect width="160" height="120" fill="#f1e9df" />
      <rect x="0" y="34" width="160" height="3" fill="#e2d5c5" />
      <rect x="10" y="14" width="7" height="20" rx="1.5" fill="#4cc28c" />
      <rect x="19" y="18" width="6" height="16" rx="1.5" fill="#ff9a8a" />
      <rect x="27" y="12" width="8" height="22" rx="1.5" fill="#f4c35b" />
      <rect x="37" y="20" width="6" height="14" rx="1.5" fill="#7cc7a9" />
      <circle cx="136" cy="22" r="10" fill="#e6d8c6" />
      <path d="M131 22h10M136 17v10" stroke="#d4c1aa" strokeWidth="2" strokeLinecap="round" />
      <path d="M38 120c0-24 18-38 42-38s42 14 42 38z" fill="#0a8a55" />
      <path d="M68 82h24l-12 14z" fill="#f6efe7" />
      <rect x="73" y="70" width="14" height="16" rx="5" fill="#eebf9c" />
      <circle cx="80" cy="25" r="10" fill="#3a2620" />
      <ellipse cx="80" cy="54" rx="18" ry="21" fill="#f3c9a6" />
      <path d="M61 52c0-16 8-24 19-24s19 8 19 24c-4-9-11-13-19-13s-15 4-19 13z" fill="#3a2620" />
      <circle cx="73" cy="55" r="5.2" fill="none" stroke="#2b1d18" strokeWidth="1.6" />
      <circle cx="87" cy="55" r="5.2" fill="none" stroke="#2b1d18" strokeWidth="1.6" />
      <path d="M78.2 55h3.6" stroke="#2b1d18" strokeWidth="1.6" />
      <path d="M75 65c3 2.4 7 2.4 10 0" stroke="#b5654f" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function AvatarStudent({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect width="160" height="120" fill="#e3ebfb" />
      <rect x="112" y="12" width="34" height="44" rx="3" fill="#f7f9ff" />
      <path d="M112 34h34M129 12v44" stroke="#d3def5" strokeWidth="2" />
      <rect x="14" y="18" width="26" height="18" rx="2" fill="#ffd166" opacity=".8" />
      <path d="M36 120c0-25 19-39 44-39s44 14 44 39z" fill="#ff6b6b" />
      <path d="M62 86c6 8 30 8 36 0" stroke="#e5484d" strokeWidth="3" fill="none" />
      <rect x="73" y="70" width="14" height="15" rx="5" fill="#dcaa82" />
      <ellipse cx="80" cy="54" rx="18" ry="20" fill="#e8b88f" />
      <path d="M61 50c-1-15 8-22 19-22 12 0 21 6 19 21-3-6-8-8-12-8-6 0-10 3-17 3-4 0-7 2-9 6z" fill="#4a3226" />
      <circle cx="73.5" cy="56" r="2.2" fill="#2b1d18" />
      <circle cx="86.5" cy="56" r="2.2" fill="#2b1d18" />
      <path d="M75 65c3 2.6 7 2.6 10 0" stroke="#a5583f" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}
