import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listTeamMembers } from '@/lib/meetingHosts';

export const dynamic = 'force-dynamic';

// Colaboradores que podem ser marcados como anfitriões de uma reunião (campo
// "Outros anfitriões" da Agenda). Qualquer pessoa da equipe consulta; só
// devolve id, nome e setor.
export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isStaff) return new NextResponse('Não autorizado', { status: 401 });
  return NextResponse.json({ members: await listTeamMembers() });
}
