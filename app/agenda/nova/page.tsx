import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { podeUsarAgendaNova } from '@/lib/agenda/servidor';
import { AppShell } from '@/components/AppShell';
import { AgendaNova } from '@/components/agenda-nova/AgendaNova';

export const dynamic = 'force-dynamic';

/** Agenda nova (estilo Google Agenda). Liberada por usuário até a validação. */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/agenda/nova');
  if (!(await podeUsarAgendaNova(user))) redirect('/agenda');
  return (
    <AppShell>
      <AgendaNova me={{ id: user.id, name: user.name, isAdmin: user.isAdmin, sector: user.sector }} />
    </AppShell>
  );
}
