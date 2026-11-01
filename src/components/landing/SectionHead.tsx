export function SectionHead({
  tag,
  title,
  text,
  className = '',
}: {
  tag: string;
  title: React.ReactNode;
  text?: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-reveal className={`max-w-[720px] ${className}`}>
      <p className="tag text-brand-700">{tag}</p>
      <h2 className="mt-4 text-[34px] leading-[1.08] font-medium sm:text-[44px]">{title}</h2>
      {text && <p className="mt-4 text-lg leading-relaxed text-ink-2">{text}</p>}
    </div>
  );
}
