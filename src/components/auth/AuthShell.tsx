import Link from 'next/link';
import { Logo } from '@/components/Logo';

export function AuthShell({ title, text, children }: { title: string; text?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 bg-mist lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <Link href="/" aria-label="На главную" className="w-fit">
          <Logo />
        </Link>
        <div className="mx-auto my-auto w-full max-w-[440px] py-10">
          <h1 className="text-[32px] leading-tight font-medium">{title}</h1>
          {text && <p className="mt-2 text-ink-2">{text}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-brand p-12 text-white lg:flex lg:flex-col lg:justify-end">
        <div
          aria-hidden="true"
          className="absolute inset-0 [background-image:linear-gradient(rgb(255_255_255/0.08)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.08)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_60%_30%,#000_10%,transparent_75%)]"
        />
        <svg viewBox="0 0 400 260" className="relative mb-auto w-full max-w-[420px] self-center" aria-hidden="true">
          <path d="M40 210H370" stroke="rgb(255 255 255 / .45)" strokeWidth="2" />
          <path d="M120 240V30" stroke="rgb(255 255 255 / .45)" strokeWidth="2" />
          <path className="draw-path" style={{ '--dur': '1.6s', '--delay': '300ms' } as React.CSSProperties} d="M50 40Q120 380 190 40" pathLength={1} fill="none" stroke="#ff5a5f" strokeWidth="5" strokeLinecap="round" />
          <path className="draw-path" style={{ '--dur': '1.6s', '--delay': '900ms' } as React.CSSProperties} d="M140 200C200 120 260 160 300 90S360 60 380 40" pathLength={1} fill="none" stroke="#ffe066" strokeWidth="5" strokeLinecap="round" />
        </svg>
        <p className="tag relative text-white/70">Для репетиторов и учеников</p>
        <p className="relative mt-4 max-w-[440px] text-[34px] leading-[1.1] font-medium">Видео, доска и переписка — в одной вкладке браузера</p>
      </aside>
    </div>
  );
}
