import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { migrar, reverter } from '@/lib/agenda/migracao';
import { corpo, soAdmin, usuarioAgenda } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

/** Lotes de migração já executados (com relatório). Só admin. */
export async function GET() {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  if (!a.user.isAdmin) return soAdmin();
  const { data } = await createAdminSupabase().from('agenda_migracoes').select('*').order('executada_em', { ascending: false });
  return NextResponse.json({ lotes: data ?? [] });
}

/** { acao: 'simular' | 'executar' | 'reverter', id? }. Só admin. Reuniões não são alteradas. */
export async function POST(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  if (!a.user.isAdmin) return soAdmin();
  const b = await corpo<{ acao?: string; id?: string }>(req);
  try {
    if (b.acao === 'reverter') {
      if (!b.id) return new NextResponse('Informe o lote', { status: 400 });
      return NextResponse.json(await reverter(b.id));
    }
    return NextResponse.json(await migrar(b.acao === 'executar', a.user.id));
  } catch (e) {
    console.error('agenda migração', e);
    return new NextResponse(e instanceof Error ? e.message : 'Falha na migração', { status: 500 });
  }
}
