import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { Configuracoes } from '@/components/agenda-nova/config/Configuracoes';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/agenda/configuracoes');
  // Agenda administrativa: só a equipe do Meet (clientes do Plan têm o mesmo login).
  if (!user.isStaff) redirect('/sem-acesso');
  return (
    <AppShell>
      <Configuracoes me={{ id: user.id, isAdmin: user.isAdmin }} />
    </AppShell>
  );
}
