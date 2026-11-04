import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app/AppHeader';
import { Assistant } from '@/components/app/Assistant';
import { aiConfigured } from '@/lib/ai';
import { getUser } from '@/lib/auth';
import { aiQuota } from '@/lib/billing';

export const metadata: Metadata = { title: 'ИИ-помощник' };

export default async function AssistantPage() {
  const user = await getUser();
  if (!user) redirect('/login?next=/assistant');
  const q = await aiQuota(user);
  const quota = { used: q.chat.used, limit: q.chat.limit, next: q.next, upgrade: user.role === 'tutor' && q.plan !== 'pro' };
  return (
    <div className="flex h-dvh flex-col bg-mist">
      <AppHeader user={user} active="assistant" />
      <Assistant name={user.name} grade={user.grade || ''} ai={aiConfigured()} quota={quota} />
    </div>
  );
}
