import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetForm } from '@/components/auth/AuthForm';
import { AuthShell } from '@/components/auth/AuthShell';

export const metadata: Metadata = { title: 'Восстановление пароля' };

export default function ResetPage() {
  return (
    <AuthShell title="Восстановление пароля" text="Пришлём код на почту — после него можно задать новый пароль.">
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
