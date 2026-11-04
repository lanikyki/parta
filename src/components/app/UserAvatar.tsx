// Фото профиля или первая буква имени на цветном круге (цвет зависит от имени).

const TINTS = ['bg-tint text-brand-800', 'bg-accent-soft text-accent-600', 'bg-[#fff4cc] text-ink', 'bg-[#e8eefc] text-[#2b4aa0]', 'bg-[#f3e8fc] text-[#6b2fa0]'];

export function tintFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function UserAvatar({ name, src, size = 40, className = '' }: { name: string; src?: string | null; size?: number; className?: string }) {
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={size} height={size} className={`shrink-0 rounded-full bg-mist object-cover ${className}`} style={{ width: size, height: size }} />
    );
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-medium ${tintFor(name)} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {(name.trim()[0] || '?').toUpperCase()}
    </span>
  );
}
