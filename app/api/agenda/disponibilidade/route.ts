import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { carregarConfig } from '@/lib/agenda/servidor';
import { corpo, executorAlvo, usuarioAgenda } from '@/lib/agenda/rota';
import type { FaixaExpediente } from '@/lib/agenda-engine';

export const dynamic = 'force-dynamic';

/** Expediente e regras do executor (as dele ou, para admin, de qualquer um). */
export async function GET(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const executorId = executorAlvo(a.user, req.nextUrl.searchParams.get('executorId'));
  if (!executorId) return new NextResponse('Não autorizado', { status: 403 });
  const admin = createAdminSupabase();
  const [cfg, exp, regras, bloqueios] = await Promise.all([
    carregarConfig(),
    admin.from('agenda_expediente').select('dia_semana, inicio, fim').eq('executor_id', executorId).order('dia_semana').order('inicio'),
    admin.from('agenda_regras_executor').select('*').eq('executor_id', executorId).maybeSingle(),
    admin
      .from('agenda_bloqueios')
      .select('id, inicio, fim, dia_inteiro, rrule, motivo')
      .eq('executor_id', executorId)
      .or(`rrule.not.is.null,fim.gt.${new Date().toISOString()}`)
      .order('inicio'),
  ]);
  const faixas = ((exp.data ?? []) as Array<{ dia_semana: number; inicio: string; fim: string }>).map((f) => ({
    diaSemana: f.dia_semana,
    inicio: f.inicio,
    fim: f.fim,
  }));
  return NextResponse.json({
    executorId,
    expediente: faixas.length ? faixas : cfg.expediente,
    usaPadrao: !faixas.length,
    regras: regras.data ?? null,
    bloqueios: bloqueios.data ?? [],
    empresa: cfg,
    podeEditarLimites: a.user.isAdmin,
  });
}

const hm = /^\d{2}:\d{2}$/;

/**
 * Executor: o próprio expediente (faixas por dia) e buffer maior ou igual ao
 * mínimo da empresa. Admin: também limites e UF/município de qualquer executor.
 */
export async function PUT(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const b = await corpo<{
    executorId?: string;
    expediente?: FaixaExpediente[] | null;
    bufferMin?: number | null;
    maxReunioesDia?: number | null;
    maxHorasDia?: number | null;
    maxHorasSemana?: number | null;
    uf?: string | null;
    municipio?: string | null;
  }>(req);
  const executorId = executorAlvo(a.user, b.executorId);
  if (!executorId) return new NextResponse('Não autorizado', { status: 403 });
  const admin = createAdminSupabase();
  const cfg = await carregarConfig();

  if (b.expediente !== undefined) {
    const faixas = b.expediente ?? [];
    if (!faixas.every((f) => f.diaSemana >= 1 && f.diaSemana <= 7 && hm.test(f.inicio) && hm.test(f.fim) && f.inicio < f.fim)) {
      return new NextResponse('Expediente inválido', { status: 400 });
    }
    await admin.from('agenda_expediente').delete().eq('executor_id', executorId);
    if (faixas.length) {
      const { error } = await admin
        .from('agenda_expediente')
        .insert(faixas.map((f) => ({ executor_id: executorId, dia_semana: f.diaSemana, inicio: f.inicio, fim: f.fim })));
      if (error) return new NextResponse('Falha ao salvar o expediente: ' + error.message, { status: 400 });
    }
  }

  const regras: Record<string, unknown> = {};
  if (b.bufferMin !== undefined) {
    if (b.bufferMin !== null && b.bufferMin < cfg.regras.bufferMin) {
      return new NextResponse(`O intervalo mínimo da empresa é ${cfg.regras.bufferMin} min`, { status: 400 });
    }
    regras.buffer_min = b.bufferMin;
  }
  const sensiveis = ['maxReunioesDia', 'maxHorasDia', 'maxHorasSemana', 'uf', 'municipio'] as const;
  if (sensiveis.some((k) => b[k] !== undefined)) {
    if (!a.user.isAdmin) return new NextResponse('Limites e local só o admin altera', { status: 403 });
    if (b.maxReunioesDia !== undefined) regras.max_reunioes_dia = b.maxReunioesDia;
    if (b.maxHorasDia !== undefined) regras.max_horas_dia = b.maxHorasDia;
    if (b.maxHorasSemana !== undefined) regras.max_horas_semana = b.maxHorasSemana;
    if (b.uf !== undefined) regras.uf = b.uf?.toUpperCase().slice(0, 2) || null;
    if (b.municipio !== undefined) regras.municipio = b.municipio?.trim() || null;
  }
  if (Object.keys(regras).length) {
    const { error } = await admin
      .from('agenda_regras_executor')
      .upsert({ executor_id: executorId, ...regras, atualizado_por: a.user.id, atualizado_em: new Date().toISOString() });
    if (error) return new NextResponse('Falha ao salvar as regras: ' + error.message, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
