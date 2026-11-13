import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { Painel } from '@/components/agenda-nova/painel/Painel';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/agenda/painel');
  // Agenda administrativa: só a equipe do Meet (clientes do Plan têm o mesmo login).
  if (!user.isStaff) redirect('/sem-acesso');
  return (
    <AppShell>
      <Painel me={{ id: user.id, isAdmin: user.isAdmin }} />
    </AppShell>
  );
}
