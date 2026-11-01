import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app/AppHeader';
import { Assistant } from '@/components/app/Assistant';
import { aiConfigured } from '@/lib/ai';
import { getUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'ИИ-помощник' };

export default async function AssistantPage() {
  const user = await getUser();
  if (!user) redirect('/login?next=/assistant');
  return (
    <div className="flex h-dvh flex-col bg-mist">
      <AppHeader user={user} active="assistant" />
      <Assistant name={user.name} grade={user.grade || ''} ai={aiConfigured()} />
    </div>
  );
}
