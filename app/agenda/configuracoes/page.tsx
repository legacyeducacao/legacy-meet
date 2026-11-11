import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { Configuracoes } from '@/components/agenda-nova/config/Configuracoes';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/agenda/configuracoes');
  return (
    <AppShell>
      <Configuracoes me={{ id: user.id, isAdmin: user.isAdmin }} />
    </AppShell>
  );
}
