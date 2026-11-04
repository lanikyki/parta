import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';

export const metadata: Metadata = { title: 'Страница не найдена', robots: { index: false } };

/** Своя страница 404 — вместо английской заглушки Next.js. */
export default function NotFound() {
  return (
    <AuthShell
      title="Страница не найдена"
      text="Возможно, в ссылке опечатка, её скопировали не полностью или урок уже удалён. Проверьте адрес или попросите прислать ссылку ещё раз."
    >
      <div className="grid gap-3">
        <Link href="/dashboard" className="btn btn-primary btn-lg w-full">
          В кабинет
        </Link>
        <Link href="/" className="btn btn-line btn-lg w-full">
          На главную
        </Link>
      </div>
    </AuthShell>
  );
}
