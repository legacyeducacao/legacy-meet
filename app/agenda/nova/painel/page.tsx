import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { podeUsarAgendaNova } from '@/lib/agenda/servidor';
import { AppShell } from '@/components/AppShell';
import { Painel } from '@/components/agenda-nova/painel/Painel';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/agenda/nova/painel');
  if (!(await podeUsarAgendaNova(user))) redirect('/agenda');
  return (
    <AppShell>
      <Painel me={{ id: user.id, isAdmin: user.isAdmin }} />
    </AppShell>
  );
}
