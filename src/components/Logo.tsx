import { BRAND } from '@/lib/brand';

/** Знак: парта, похожая на букву «П», и яблоко на ней. */
export function LogoMark({ className = 'h-8 w-8', inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill={inverted ? '#fff' : '#12a566'} />
      <path
        d="M8 14.6L24 11.2M11.2 14v9.5M20.8 12v11.5"
        fill="none"
        stroke={inverted ? '#12a566' : '#fff'}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="20.6" cy="7.6" r="2.3" fill="#ff5a5f" />
    </svg>
  );
}

export function Logo({ inverted = false, className = '' }: { inverted?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark inverted={inverted} />
      <span className="text-[21px] font-semibold tracking-[-0.03em]">{BRAND.name}</span>
    </span>
  );
}
