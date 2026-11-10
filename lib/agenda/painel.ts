/**
 * Painel de KPIs da agenda (servidor): carrega reuniões, cancelamentos,
 * remarcações e duração real das gravações e calcula, com o motor, os
 * indicadores do período e do período anterior.
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import {
  addDays,
  calcularKpis,
  horasPorSemana,
  instante,
  kpisJornadasImpulsao,
  localYmd,
  mapaOcupacao,
  periodoAnterior,
  riscoJornadaLegado,
  somarKpis,
  type GravacaoKpi,
  type Periodo,
  type ResultadoKpis,
  type ReuniaoKpi,
} from '@/lib/agenda-engine';
import { calendarioDe, carregarConfig, contextoExecutor, FUSO } from './servidor';

type Linha = {
  id: string;
  host_id: string;
  status: string;
  scheduled_start_at: string;
  scheduled_end_at: string | null;
  tenant_id: string | null;
  client_tenants: { produto: string | null } | null;
  meet_meeting_sector: { sector: string } | { sector: string }[] | null;
};

const pick = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const STATUS: Record<string, ReuniaoKpi['status']> = { canceled: 'cancelada', no_show: 'no_show', ended: 'realizada', live: 'realizada', scheduled: 'agendada' };

export interface Filtros {
  periodo: Periodo;
  /** null = todos (só admin). */
  executores: string[] | null;
  produto?: string | null;
  tenantId?: string | null;
}

export async function montarPainel(f: Filtros) {
  const admin = createAdminSupabase();
  const anterior = periodoAnterior(f.periodo);
  const de = instante(anterior.de, '00:00', FUSO);
  const ate = instante(addDays(f.periodo.ate, 1), '00:00', FUSO);

  let q = admin
    .from('meetings')
    .select('id, host_id, status, scheduled_start_at, scheduled_end_at, tenant_id, client_tenants:tenant_id(produto), meet_meeting_sector!inner(sector)')
    .gte('scheduled_start_at', de.toISOString())
    .lt('scheduled_start_at', ate.toISOString())
    .limit(10000);
  if (f.executores) q = q.in('host_id', f.executores);
  if (f.tenantId) q = q.eq('tenant_id', f.tenantId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as unknown as Linha[];
  const ids = linhas.map((l) => l.id);

  const lotes = <T,>(fn: (fatia: string[]) => PromiseLike<{ data: T[] | null }>) =>
    Promise.all(Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => fn(ids.slice(i * 200, i * 200 + 200)))).then((rs) =>
      rs.flatMap((r) => r.data ?? []),
    );
  const [cancs, remarcs, durs, ocs] = await Promise.all([
    lotes<{ meeting_id: string; origem: string; criado_em: string }>((x) => admin.from('agenda_cancelamentos').select('meeting_id, origem, criado_em').in('meeting_id', x)),
    lotes<{ meeting_id: string; origem: string | null }>((x) => admin.from('agenda_remarcacoes').select('meeting_id, origem').in('meeting_id', x)),
    lotes<{ meeting_id: string; inicio: string | null; duracao_seg: number }>((x) => admin.from('agenda_gravacoes_duracao').select('meeting_id, inicio, duracao_seg').in('meeting_id', x)),
    lotes<{ meeting_id: string; agenda_series: { grupo_id: string | null } | { grupo_id: string | null }[] | null }>((x) => admin.from('agenda_ocorrencias').select('meeting_id, agenda_series(grupo_id)').in('meeting_id', x)),
  ]);
  const origemCanc = new Map(cancs.sort((a, b) => a.criado_em.localeCompare(b.criado_em)).map((c) => [c.meeting_id, c.origem]));
  const remarcada = new Map(remarcs.map((r) => [r.meeting_id, r.origem ?? 'executor']));
  const deGrupo = new Set(ocs.filter((o) => pick(o.agenda_series)?.grupo_id).map((o) => o.meeting_id));

  const reunioes: Array<ReuniaoKpi & { host: string }> = linhas.map((l) => {
    const inicio = new Date(l.scheduled_start_at);
    const fimBruto = l.scheduled_end_at ? new Date(l.scheduled_end_at) : new Date(inicio.getTime() + 3_600_000);
    const sec = pick(l.meet_meeting_sector);
    return {
      id: l.id,
      host: l.host_id,
      produto: deGrupo.has(l.id) ? 'impulsao' : calendarioDe(sec?.sector, l.client_tenants?.produto),
      inicio,
      fim: fimBruto > inicio ? fimBruto : new Date(inicio.getTime() + 3_600_000),
      status: STATUS[l.status] ?? 'agendada',
      origemCancelamento: (origemCanc.get(l.id) as ReuniaoKpi['origemCancelamento']) ?? null,
      remarcadaPor: (remarcada.get(l.id) as ReuniaoKpi['remarcadaPor']) ?? null,
    };
  });
  const filtradas = f.produto ? reunioes.filter((r) => r.produto === f.produto) : reunioes;
  const gravacoes: GravacaoKpi[] = durs.map((d) => ({ reuniaoId: d.meeting_id, inicio: new Date(d.inicio ?? 0), duracaoSeg: d.duracao_seg }));

  // Reunião antiga sem anfitrião não entra (host null quebraria a busca de nomes).
  const executores = f.executores ?? [...new Set(filtradas.map((r) => r.host).filter((x): x is string => !!x))];
  const cfg = await carregarConfig();
  const { data: nomes, error: erroNomes } = executores.length ? await admin.from('users').select('id, name').in('id', executores) : { data: [], error: null };
  if (erroNomes) console.error('painel: nomes', erroNomes.message);
  const nomeDe = new Map(((nomes ?? []) as Array<{ id: string; name: string | null }>).map((u) => [u.id, u.name ?? 'Sem nome']));

  const porExecutor: Array<{ id: string; nome: string; atual: ResultadoKpis; anterior: ResultadoKpis }> = [];
  for (const id of executores.slice(0, 60)) {
    const ctx = await contextoExecutor(id, de, ate, cfg);
    const minhas = filtradas.filter((r) => r.host === id);
    porExecutor.push({
      id,
      nome: nomeDe.get(id) ?? 'Sem nome',
      atual: calcularKpis(f.periodo, ctx, minhas, gravacoes),
      anterior: calcularKpis(anterior, ctx, minhas, gravacoes),
    });
  }

  const noPeriodo = filtradas.filter((r) => {
    const d = localYmd(r.inicio, FUSO);
    return d >= f.periodo.de && d <= f.periodo.ate;
  });

  return {
    periodo: f.periodo,
    anteriorPeriodo: anterior,
    atual: somarKpis(porExecutor.map((p) => p.atual)),
    anterior: somarKpis(porExecutor.map((p) => p.anterior)),
    porExecutor: porExecutor
      .map((p) => ({ id: p.id, nome: p.nome, atual: p.atual }))
      .sort((a, b) => b.atual.horasRealizadas - a.atual.horasRealizadas),
    semanas: horasPorSemana(noPeriodo, gravacoes, FUSO),
    mapa: mapaOcupacao(noPeriodo, FUSO),
    limiteSemanal: cfg.regras.maxHorasSemana ?? null,
    jornadas: await jornadasDoPainel(f.executores),
  };
}

async function jornadasDoPainel(executores: string[] | null) {
  const admin = createAdminSupabase();
  let q = admin
    .from('agenda_jornadas')
    .select('id, produto, status, inicio, fim_previsto, encontros_previstos, executor_id, grupo_id, client_tenants(name), agenda_grupos(nome), agenda_jornada_encontros(numero, rotulo, data, presenca, meeting_id)')
    .in('status', ['ativa', 'concluida'])
    .limit(1000);
  if (executores) q = q.in('executor_id', executores);
  const { data } = await q;
  type J = {
    id: string;
    produto: string;
    status: 'ativa' | 'concluida';
    inicio: string;
    fim_previsto: string | null;
    encontros_previstos: number;
    grupo_id: string | null;
    client_tenants: { name: string } | null;
    agenda_grupos: { nome: string } | null;
    agenda_jornada_encontros: Array<{ numero: number; rotulo: string | null; data: string | null; presenca: 'pendente' | 'presente' | 'faltou'; meeting_id: string | null }>;
  };
  const js = (data ?? []) as unknown as J[];
  const hoje = localYmd(new Date(), FUSO);

  // Legado: realizado = encontro com reunião encerrada (ou presença marcada).
  const legado = js.filter((j) => j.produto === 'legado' && j.status === 'ativa');
  const ids = legado.flatMap((j) => j.agenda_jornada_encontros.map((e) => e.meeting_id)).filter(Boolean) as string[];
  const encerradas = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: ms } = await admin.from('meetings').select('id').in('id', ids.slice(i, i + 200)).eq('status', 'ended');
    for (const m of (ms ?? []) as Array<{ id: string }>) encerradas.add(m.id);
  }
  const impulsao = js.filter((j) => j.produto === 'impulsao');
  const nomesGrupo = Object.fromEntries(impulsao.map((j) => [j.grupo_id ?? '', j.agenda_grupos?.nome ?? 'Grupo']));
  const k = kpisJornadasImpulsao(
    impulsao.map((j) => ({
      clienteId: j.client_tenants?.name ?? j.id,
      grupoId: j.grupo_id ?? '',
      status: j.status,
      encontros: j.agenda_jornada_encontros.map((e) => ({ numero: e.numero, rotulo: e.rotulo ?? '', presenca: e.presenca })),
    })),
    ['F2', 'C2'],
  );
  return {
    impulsao: {
      ativosPorGrupo: Object.entries(k.ativosPorGrupo).map(([gid, n]) => ({ grupo: nomesGrupo[gid] ?? 'Grupo', clientes: n })),
      progresso: k.progresso,
      faltaramAula2: k.faltaramAula2,
    },
    legado: legado
      .map((j) => {
        const realizados = j.agenda_jornada_encontros.filter((e) => (e.meeting_id && encerradas.has(e.meeting_id)) || e.presenca === 'presente').length;
        return { cliente: j.client_tenants?.name ?? 'Cliente', ...riscoJornadaLegado({ clienteId: j.id, inicio: j.inicio, fim: j.fim_previsto ?? j.inicio, previstos: j.encontros_previstos, realizados }, hoje), realizados, previstos: j.encontros_previstos };
      })
      .sort((a, b) => Number(b.emRisco) - Number(a.emRisco) || b.pendentes - a.pendentes),
  };
}
