import { notFound, redirect } from 'next/navigation';
import { getCurrentUser, podeGerenciarKickoff } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { KickoffsImpulsao } from '@/components/agenda-nova/kickoffs/KickoffsImpulsao';

export const dynamic = 'force-dynamic';

/** Seção "Kickoffs Impulsão": só para quem gerencia kickoffs. */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/agenda/kickoffs');
  if (!user.isStaff) redirect('/sem-acesso');
  // Quem não gerencia kickoffs não fica sabendo que a seção existe.
  if (!podeGerenciarKickoff(user)) notFound();
  return (
    <AppShell>
      <KickoffsImpulsao />
    </AppShell>
  );
}
