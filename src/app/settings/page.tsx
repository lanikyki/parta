import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountShell } from '@/components/app/AccountShell';
import { SettingsForms } from '@/components/app/SettingsForms';
import { getUser } from '@/lib/auth';
import { one } from '@/lib/db';

export const metadata: Metadata = { title: 'Настройки' };

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) redirect('/login?next=/settings');
  const u = await one<{ notify_messages: boolean; notify_billing: boolean }>('select notify_messages, notify_billing from users where id = $1', [user.id]);
  return (
    <AccountShell user={user} active="settings" title="Настройки">
      <SettingsForms tutor={user.role === 'tutor'} notifyMessages={u?.notify_messages ?? true} notifyBilling={u?.notify_billing ?? true} />
    </AccountShell>
  );
}
