import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Identidade do usuário logado para a UI (nav/cabeçalho). Sem sessão → user:null.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({ user: { name: user.name, role: user.role } });
}
