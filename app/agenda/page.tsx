import { redirect } from 'next/navigation';
import { canSeeComercial, getCurrentUser, podeGerenciarKickoff } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { AgendaNova } from '@/components/agenda-nova/AgendaNova';

export const dynamic = 'force-dynamic';

/** Agenda (estilo Google Agenda): a única agenda do Meet desde 11/11/2026. */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/agenda');
  // Agenda administrativa: só a equipe do Meet (clientes do Plan têm o mesmo login).
  if (!user.isStaff) redirect('/sem-acesso');
  return (
    <AppShell>
      <AgendaNova
        me={{
          id: user.id,
          name: user.name,
          isAdmin: user.isAdmin,
          sector: user.sector,
          podeComercial: canSeeComercial(user),
          podeKickoff: podeGerenciarKickoff(user),
          funcaoComercial: user.funcaoComercial ?? null,
        }}
      />
    </AppShell>
  );
}
