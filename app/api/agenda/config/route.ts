import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { carregarConfig } from '@/lib/agenda/servidor';
import { corpo, soAdmin, usuarioAgenda } from '@/lib/agenda/rota';
import { NIVEIS_PADRAO, type FaixaExpediente } from '@/lib/agenda-engine';

export const dynamic = 'force-dynamic';

/** Padrões da empresa (expediente, buffer mínimo, limites, níveis das regras, horizonte, facultativos). */
export async function GET() {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  return NextResponse.json({ config: await carregarConfig(), podeEditar: a.user.isAdmin });
}

const hm = /^\d{2}:\d{2}$/;

/** Só admin. Corpo parcial: só as chaves enviadas mudam. */
export async function PUT(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  if (!a.user.isAdmin) return soAdmin();
  const b = await corpo<{
    expediente?: FaixaExpediente[];
    regras?: { bufferMin?: number; maxReunioesDia?: number | null; maxHorasDia?: number | null; maxHorasSemana?: number | null };
    niveis?: Record<string, 'bloqueante' | 'aviso'>;
    horizonteMeses?: number;
    considerarFacultativos?: boolean;
  }>(req);

  const linhas: Array<{ chave: string; valor: unknown }> = [];
  if (b.expediente) {
    const ok = b.expediente.every((f) => f.diaSemana >= 1 && f.diaSemana <= 7 && hm.test(f.inicio) && hm.test(f.fim) && f.inicio < f.fim);
    if (!ok) return new NextResponse('Expediente inválido', { status: 400 });
    linhas.push({ chave: 'expediente_padrao', valor: b.expediente });
  }
  if (b.regras) {
    const r = b.regras;
    if (r.bufferMin !== undefined && (r.bufferMin < 0 || r.bufferMin > 240)) return new NextResponse('Buffer inválido', { status: 400 });
    linhas.push({ chave: 'regras_padrao', valor: r });
  }
  if (b.niveis) {
    const niveis = Object.fromEntries(
      Object.entries(b.niveis).filter(([k, v]) => k in NIVEIS_PADRAO && (v === 'bloqueante' || v === 'aviso')),
    );
    linhas.push({ chave: 'niveis', valor: niveis });
  }
  if (b.horizonteMeses !== undefined) {
    if (!(b.horizonteMeses >= 1 && b.horizonteMeses <= 24)) return new NextResponse('Horizonte entre 1 e 24 meses', { status: 400 });
    linhas.push({ chave: 'horizonte_meses', valor: b.horizonteMeses });
  }
  if (typeof b.considerarFacultativos === 'boolean') linhas.push({ chave: 'considerar_facultativos', valor: b.considerarFacultativos });
  if (!linhas.length) return NextResponse.json({ ok: true });

  const { error } = await createAdminSupabase()
    .from('agenda_config')
    .upsert(linhas.map((l) => ({ ...l, atualizado_por: a.user.id, atualizado_em: new Date().toISOString() })));
  if (error) return new NextResponse('Falha ao salvar: ' + error.message, { status: 500 });
  return NextResponse.json({ ok: true, config: await carregarConfig() });
}
