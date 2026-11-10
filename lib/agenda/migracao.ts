/**
 * Fase 6: traz as séries que já existem (public.meetings ligadas por
 * recurrence_parent_id, criadas pela Agenda antiga ou pelo Legacy Plan) para
 * agenda_series/agenda_ocorrencias e cria as jornadas do Legado.
 * Não altera nenhuma reunião. Reversível pelo lote (agenda_migracoes).
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { localYmd, utcToLocal } from '@/lib/agenda-engine';
import { FUSO } from './servidor';
import { PRESENCA, rruleDeRegraAntiga, STATUS_OCORRENCIA } from './migracaoRegras';

type Linha = {
  id: string;
  title: string | null;
  host_id: string | null;
  status: string;
  scheduled_start_at: string;
  scheduled_end_at: string | null;
  recurrence_parent_id: string;
  recurrence_rule: string | null;
  tenant_id: string | null;
  recording_enabled: boolean | null;
  auto_transcribe: boolean | null;
  client_tenants: { produto: string | null } | null;
  meet_meeting_sector: { sector: string; onboarding: boolean } | { sector: string; onboarding: boolean }[] | null;
};

const pick = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const pad = (n: number) => String(n).padStart(2, '0');
const localStr = (d: Date) => {
  const l = utcToLocal(d, FUSO);
  return `${l.year}-${pad(l.month)}-${pad(l.day)}T${pad(l.hour)}:${pad(l.minute)}`;
};

async function carregarSeries(): Promise<Map<string, Linha[]>> {
  const admin = createAdminSupabase();
  const todas: Linha[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin
      .from('meetings')
      .select(
        'id, title, host_id, status, scheduled_start_at, scheduled_end_at, recurrence_parent_id, recurrence_rule, tenant_id, recording_enabled, auto_transcribe, client_tenants:tenant_id(produto), meet_meeting_sector(sector, onboarding)',
      )
      .not('recurrence_parent_id', 'is', null)
      .order('scheduled_start_at')
      .range(de, de + 999);
    if (error) throw new Error(error.message);
    todas.push(...((data ?? []) as unknown as Linha[]));
    if (!data || data.length < 1000) break;
  }
  const grupos = new Map<string, Linha[]>();
  for (const l of todas) {
    if (!grupos.has(l.recurrence_parent_id)) grupos.set(l.recurrence_parent_id, []);
    grupos.get(l.recurrence_parent_id)!.push(l);
  }
  return grupos;
}

export interface Relatorio {
  seriesEncontradas: number;
  jaNoModeloNovo: number;
  semAnfitriao: number;
  seriesMigradas: number;
  ocorrencias: number;
  jornadasLegado: { ativas: number; concluidas: number };
  regras: Record<string, number>;
  porExecutor: Array<{ nome: string; series: number }>;
  exemplos: Array<{ titulo: string; rrule: string; reunioes: number }>;
}

export async function migrar(executar: boolean, usuarioId: string): Promise<{ migracaoId: string | null; relatorio: Relatorio }> {
  const admin = createAdminSupabase();
  const grupos = await carregarSeries();
  const { data: existentes } = await admin.from('agenda_series').select('recurrence_parent_id').not('recurrence_parent_id', 'is', null);
  const ja = new Set(((existentes ?? []) as Array<{ recurrence_parent_id: string }>).map((s) => s.recurrence_parent_id));
  const hoje = localYmd(new Date(), FUSO);

  const rel: Relatorio = {
    seriesEncontradas: grupos.size,
    jaNoModeloNovo: 0,
    semAnfitriao: 0,
    seriesMigradas: 0,
    ocorrencias: 0,
    jornadasLegado: { ativas: 0, concluidas: 0 },
    regras: {},
    porExecutor: [],
    exemplos: [],
  };
  const porHost = new Map<string, number>();
  type Plano = { parent: string; linhas: Linha[]; serie: Record<string, unknown>; legado: boolean };
  const planos: Plano[] = [];

  for (const [parent, linhas] of grupos) {
    if (ja.has(parent)) {
      rel.jaNoModeloNovo++;
      continue;
    }
    const primeira = linhas.find((l) => l.id === parent) ?? linhas[0];
    if (!primeira.host_id) {
      rel.semAnfitriao++;
      continue;
    }
    const inicio = new Date(primeira.scheduled_start_at);
    const fim = primeira.scheduled_end_at ? new Date(primeira.scheduled_end_at) : new Date(inicio.getTime() + 3_600_000);
    const { rrule, origem } = rruleDeRegraAntiga(primeira.recurrence_rule, inicio, linhas.length, FUSO);
    rel.regras[origem] = (rel.regras[origem] ?? 0) + 1;
    const sec = pick(primeira.meet_meeting_sector);
    const legado = sec?.sector === 'executoria' && !!primeira.client_tenants?.produto?.startsWith('legado') && linhas.filter((l) => l.status !== 'canceled').length >= 4;
    porHost.set(primeira.host_id, (porHost.get(primeira.host_id) ?? 0) + 1);
    planos.push({
      parent,
      linhas,
      legado,
      serie: {
        executor_id: primeira.host_id,
        titulo: primeira.title?.trim() || 'Reunião',
        setor: sec?.sector === 'comercial' ? 'comercial' : 'executoria',
        tenant_id: primeira.tenant_id,
        rrule,
        inicio_local: localStr(inicio),
        fuso: FUSO,
        duracao_min: Math.max(15, Math.round((fim.getTime() - inicio.getTime()) / 60_000) || 60),
        gravar: primeira.recording_enabled !== false,
        transcrever: primeira.auto_transcribe !== false,
        onboarding: sec?.onboarding === true,
        recurrence_parent_id: parent,
        politica_feriado: 'manter',
      },
    });
    if (rel.exemplos.length < 10) rel.exemplos.push({ titulo: primeira.title ?? '', rrule, reunioes: linhas.length });
  }
  rel.seriesMigradas = planos.length;
  rel.ocorrencias = planos.reduce((t, p) => t + p.linhas.length, 0);
  for (const p of planos.filter((x) => x.legado)) {
    const ultima = localYmd(new Date(p.linhas[p.linhas.length - 1].scheduled_start_at), FUSO);
    if (ultima < hoje) rel.jornadasLegado.concluidas++;
    else rel.jornadasLegado.ativas++;
  }
  const ids = [...porHost.keys()];
  const { data: nomes } = ids.length ? await admin.from('users').select('id, name').in('id', ids) : { data: [] };
  const nomeDe = new Map(((nomes ?? []) as Array<{ id: string; name: string | null }>).map((u) => [u.id, u.name ?? 'Sem nome']));
  rel.porExecutor = [...porHost.entries()].map(([id, n]) => ({ nome: nomeDe.get(id) ?? 'Sem nome', series: n })).sort((a, b) => b.series - a.series);

  if (!executar) return { migracaoId: null, relatorio: rel };

  const { data: lote, error: eLote } = await admin.from('agenda_migracoes').insert({ executada_por: usuarioId, relatorio: rel }).select('id').single();
  if (eLote) throw new Error(eLote.message);

  for (let i = 0; i < planos.length; i += 50) {
    const fatia = planos.slice(i, i + 50);
    const { data: criadas, error } = await admin
      .from('agenda_series')
      .insert(fatia.map((p) => ({ ...p.serie, migracao_id: lote.id })))
      .select('id, recurrence_parent_id');
    if (error) throw new Error(`séries: ${error.message}`);
    const serieDe = new Map(((criadas ?? []) as Array<{ id: string; recurrence_parent_id: string }>).map((s) => [s.recurrence_parent_id, s.id]));

    const ocorrencias = fatia.flatMap((p) =>
      p.linhas.map((l, k) => ({
        serie_id: serieDe.get(p.parent),
        inicio_original: new Date(l.scheduled_start_at).toISOString(),
        ordem: k,
        status: STATUS_OCORRENCIA[l.status] ?? 'agendada',
        meeting_id: l.id,
      })),
    );
    for (let j = 0; j < ocorrencias.length; j += 500) {
      const { error: e2 } = await admin.from('agenda_ocorrencias').upsert(ocorrencias.slice(j, j + 500), { onConflict: 'serie_id,inicio_original', ignoreDuplicates: true });
      if (e2) throw new Error(`ocorrências: ${e2.message}`);
    }

    for (const p of fatia.filter((x) => x.legado)) {
      const validas = p.linhas.filter((l) => l.status !== 'canceled');
      const ultima = localYmd(new Date(validas[validas.length - 1].scheduled_start_at), FUSO);
      const { data: j, error: e3 } = await admin
        .from('agenda_jornadas')
        .insert({
          tenant_id: p.serie.tenant_id,
          produto: 'legado',
          serie_id: serieDe.get(p.parent),
          executor_id: p.serie.executor_id,
          inicio: localYmd(new Date(validas[0].scheduled_start_at), FUSO),
          fim_previsto: ultima,
          encontros_previstos: validas.length,
          status: ultima < hoje ? 'concluida' : 'ativa',
          migracao_id: lote.id,
        })
        .select('id')
        .single();
      if (e3 || !j) continue;
      await admin.from('agenda_jornada_encontros').insert(
        validas.map((l, k) => ({
          jornada_id: j.id,
          numero: k + 1,
          data: localYmd(new Date(l.scheduled_start_at), FUSO),
          meeting_id: l.id,
          presenca: PRESENCA[l.status] ?? 'pendente',
        })),
      );
    }
  }
  return { migracaoId: lote.id, relatorio: rel };
}

/** Desfaz um lote: apaga séries (ocorrências vão junto) e jornadas criadas por ele. */
export async function reverter(migracaoId: string): Promise<{ series: number; jornadas: number }> {
  const admin = createAdminSupabase();
  const { count: jornadas } = await admin.from('agenda_jornadas').delete({ count: 'exact' }).eq('migracao_id', migracaoId);
  const { count: series } = await admin.from('agenda_series').delete({ count: 'exact' }).eq('migracao_id', migracaoId);
  await admin.from('agenda_migracoes').update({ revertida_em: new Date().toISOString() }).eq('id', migracaoId);
  return { series: series ?? 0, jornadas: jornadas ?? 0 };
}
