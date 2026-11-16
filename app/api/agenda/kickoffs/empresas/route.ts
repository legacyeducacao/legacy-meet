import { NextRequest, NextResponse } from 'next/server';
import { gestorDeKickoff } from '@/lib/kickoff/rota';
import { buscarEmpresas } from '@/lib/kickoff/reservas';

export const dynamic = 'force-dynamic';

/**
 * Busca de empresas (client_tenants) para inscrever num kickoff. Só gestores de
 * kickoff; exige ao menos 2 letras e devolve no máximo 20, sem as empresas
 * internas. Não é rota pública (o middleware exige login).
 */
export async function GET(req: NextRequest) {
  const g = await gestorDeKickoff();
  if (g.res) return g.res;
  const q = req.nextUrl.searchParams.get('q') ?? '';
  try {
    return NextResponse.json({ empresas: await buscarEmpresas(q) });
  } catch {
    return new NextResponse('Falha ao buscar empresas', { status: 500 });
  }
}
