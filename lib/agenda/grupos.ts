/**
 * Grupos do Impulsão no servidor: gerar (materializar) os encontros de um
 * grupo até o horizonte, matricular cliente (entrada + jornada) e estender
 * todos os grupos ativos. Cada encontro vira uma reunião do Meet.
 */
import { emSegundoPlano } from '@/lib/segundoPlano';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { changeCalendarAttendees } from '@/lib/calendar';
import { criarReunioes } from '@/lib/meetingsCore';
import { listTeamMembers } from '@/lib/meetingHosts';
import {
  addDays,
  gerarJornada,
  localYmd,
  ocorrenciasDoGrupo,
  sugerirEntrada,
  validarConflitos,
  type Feriado,
  type GrupoConfig,
  type Jornada,
  type SugestaoEntrada,
  type Ymd,
} from '@/lib/agenda-engine';
import { carregarConfig, carregarFeriados, contextoExecutor, registrarSobreposicoes, FUSO } from './servidor';
import { decidirConflitos } from './regras';
import type { RespostaConflito } from './tipos';

const DIA_RRULE = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export type LinhaGrupo = {
  id: string;
  nome: string;
  template_id: string | null;
  executor_id: string;
  substituto_id: string | null;
  tenant_id: string | null;
  dia_semana: number;
  hora: string;
  duracao_min: number;
  fuso: string;
  sequencia: string[];
  defasagem: number;
  ancora: string;
  politica_feriado: 'pausa' | 'segue';
  entradas_permitidas: string[];
  inicio: string | null;
  fim: string | null;
  ativo: boolean;
};

export function paraConfig(g: LinhaGrupo): GrupoConfig {
  return {
    id: g.id,
    nome: g.nome,
    diaSemana: g.dia_semana,
    hora: g.hora,
    duracaoMin: g.duracao_min,
    fuso: g.fuso || FUSO,
    sequencia: g.sequencia,
    defasagem: g.defasagem,
    ancora: g.ancora,
    politicaFeriado: g.politica_feriado,
    entradasPermitidas: g.entradas_permitidas,
    inicio: g.inicio ?? undefined,
    fim: g.fim ?? undefined,
  };
}

export async function gruposAtivos(): Promise<LinhaGrupo[]> {
  const { data, error } = await createAdminSupabase().from('agenda_grupos').select('*').eq('ativo', true).order('dia_semana');
  if (error) throw new Error(error.message);
  return (data ?? []) as LinhaGrupo[];
}

async function feriadosPeriodo(de: Date, ate: Date): Promise<Feriado[]> {
  return carregarFeriados(de, ate);
}

async function serieDoGrupo(g: LinhaGrupo, criadoPor: string) {
  const admin = createAdminSupabase();
  const { data } = await admin.from('agenda_series').select('id, recurrence_parent_id').eq('grupo_id', g.id).is('encerrada_em', null).maybeSingle();
  if (data) return data as { id: string; recurrence_parent_id: string | null };
  const { data: criada, error } = await admin
    .from('agenda_series')
    .insert({
      grupo_id: g.id,
      template_id: g.template_id,
      executor_id: g.executor_id,
      titulo: `Impulsão · ${g.nome}`,
      setor: 'executoria',
      tenant_id: g.tenant_id,
      rrule: `FREQ=WEEKLY;BYDAY=${DIA_RRULE[g.dia_semana - 1]}`,
      inicio_local: `${g.inicio ?? g.ancora}T${g.hora}`,
      fuso: g.fuso || FUSO,
      duracao_min: g.duracao_min,
      sequencia: g.sequencia,
      defasagem: g.defasagem,
      politica_feriado: 'manter',
      criado_por: criadoPor,
    })
    .select('id, recurrence_parent_id')
    .single();
  if (error) throw new Error(`série do grupo: ${error.message}`);
  return criada as { id: string; recurrence_parent_id: string | null };
}

export type ResultadoGerar =
  | { ok: true; criadas: number; semConteudo: number; substituto: number }
  | { ok: false; conflito: RespostaConflito }
  | { ok: false; erro: string };

/**
 * Cria as reuniões do grupo de hoje (ou do início do grupo) até `ate`
 * (padrão: horizonte da empresa). Idempotente: datas já geradas são puladas.
 * Encontro que cai em bloqueio do executor vai para o substituto; sem
 * substituto, a geração para e pede decisão (o grupo nunca fica sem
 * responsável).
 */
export async function gerarGrupo(
  grupoId: string,
  usuario: { id: string; isAdmin: boolean },
  opts: { ate?: Date; justificativa?: string; aceitarAvisos?: boolean } = {},
): Promise<ResultadoGerar> {
  const admin = createAdminSupabase();
  const { data: row } = await admin.from('agenda_grupos').select('*').eq('id', grupoId).maybeSingle();
  if (!row) return { ok: false, erro: 'Grupo não encontrado' };
  const g = row as LinhaGrupo;
  if (!g.ativo) return { ok: false, erro: 'Grupo encerrado' };

  const cfg = await carregarConfig();
  const agora = new Date();
  const horizonte = new Date(agora.getTime());
  horizonte.setUTCMonth(horizonte.getUTCMonth() + cfg.horizonteMeses);
  const ate = opts.ate && opts.ate < horizonte ? opts.ate : horizonte;
  const hoje = localYmd(agora, g.fuso || FUSO);
  const de: Ymd = g.inicio && g.inicio > hoje ? g.inicio : hoje;
  const ateYmd = localYmd(ate, g.fuso || FUSO);
  if (de > ateYmd) return { ok: true, criadas: 0, semConteudo: 0, substituto: 0 };

  const feriados = await feriadosPeriodo(new Date(`${de}T00:00:00Z`), ate);
  const ocorrencias = ocorrenciasDoGrupo(paraConfig(g), de, ateYmd, feriados).filter((o) => o.inicio > agora);
  const serie = await serieDoGrupo(g, usuario.id);
  const { data: existentes } = await admin.from('agenda_ocorrencias').select('inicio_original').eq('serie_id', serie.id);
  const ja = new Set(((existentes ?? []) as Array<{ inicio_original: string }>).map((e) => new Date(e.inicio_original).getTime()));
  const novas = ocorrencias.filter((o) => !ja.has(o.inicio.getTime()));
  const comAula = novas.filter((o) => o.status === 'normal');
  const semAula = novas.filter((o) => o.status !== 'normal');

  // Conflitos na agenda do executor responsável.
  let porSubstituto = new Set<number>();
  let registrar: Parameters<typeof registrarSobreposicoes>[0] = [];
  if (comAula.length) {
    const ctx = await contextoExecutor(g.executor_id, comAula[0].inicio, new Date(comAula[comAula.length - 1].fim.getTime() + 86_400_000), cfg);
    const conflitos = validarConflitos(comAula.map((o, k) => ({ ref: String(k), inicio: o.inicio, fim: o.fim, grupo: true })), ctx);
    const emBloqueio = new Set(conflitos.filter((c) => c.tipo === 'bloqueio').map((c) => Number(c.ref)));
    if (g.substituto_id && emBloqueio.size) porSubstituto = emBloqueio;
    // Na extensão automática (e na matrícula), avisos já foram aceitos quando o grupo foi gerado.
    const restantes = conflitos.filter(
      (c) => !(porSubstituto.has(Number(c.ref)) && c.tipo === 'bloqueio') && !(opts.aceitarAvisos && c.nivel === 'aviso'),
    );
    const decisao = decidirConflitos(restantes, usuario.isAdmin, opts.justificativa);
    if (!decisao.ok) return { ok: false, conflito: decisao.resposta };
    registrar = decisao.registrar;
  }

  const team = await listTeamMembers();
  const tenantId = g.tenant_id ?? process.env.MEET_COMMERCIAL_TENANT_ID!;
  const criadasIds = new Map<number, string>();
  for (const host of [g.executor_id, g.substituto_id]) {
    if (!host) continue;
    const lote = comAula.map((o, k) => ({ o, k })).filter(({ k }) => (porSubstituto.has(k) ? host === g.substituto_id : host === g.executor_id));
    if (!lote.length) continue;
    const r = await criarReunioes({
      hostId: host,
      hostEmail: team.find((m) => m.id === host)?.email ?? null,
      sector: 'executoria',
      tenantId,
      title: `Impulsão · ${g.nome}`,
      titulos: lote.map(({ o }) => `Impulsão · ${g.nome} · ${o.rotulo}`),
      ocorrencias: lote.map(({ o }) => ({ inicio: o.inicio, fim: o.fim })),
      record: true,
      transcribe: true,
      onboarding: false,
      coHostIds: [],
      team,
      guestEmails: [],
      recurrenceRule: `rrule:FREQ=WEEKLY;BYDAY=${DIA_RRULE[g.dia_semana - 1]}`,
      recurrenceParentId: host === g.executor_id ? serie.recurrence_parent_id : null,
    });
    if (!r.ok) return { ok: false, erro: r.message };
    lote.forEach(({ k }, i) => criadasIds.set(k, r.ids[i]));
    if (host === g.executor_id && !serie.recurrence_parent_id) {
      serie.recurrence_parent_id = r.ids[0];
      await admin.from('agenda_series').update({ recurrence_parent_id: r.ids[0] }).eq('id', serie.id);
    }
  }

  const linhas = [
    ...comAula.map((o, k) => ({
      serie_id: serie.id,
      inicio_original: o.inicio.toISOString(),
      rotulo: o.rotulo,
      status: 'agendada',
      meeting_id: criadasIds.get(k) ?? null,
      executor_substituto_id: porSubstituto.has(k) ? g.substituto_id : null,
    })),
    ...semAula.map((o) => ({
      serie_id: serie.id,
      inicio_original: o.inicio.toISOString(),
      rotulo: o.rotulo,
      status: 'pulada_feriado',
      motivo_excecao: o.feriado ?? null,
      meeting_id: null,
    })),
  ];
  if (linhas.length) {
    const { error } = await admin.from('agenda_ocorrencias').upsert(linhas, { onConflict: 'serie_id,inicio_original', ignoreDuplicates: true });
    if (error) console.error('agenda: ocorrências do grupo', error);
  }
  if (registrar.length) {
    await registrarSobreposicoes(registrar, usuario.id, opts.justificativa!.trim(), (ref) => criadasIds.get(Number(ref)) ?? null, serie.id);
  }
  return { ok: true, criadas: criadasIds.size, semConteudo: semAula.length, substituto: porSubstituto.size };
}

/** Estende todos os grupos ativos até o horizonte (rotina periódica). Nunca lança. */
export async function estenderGrupos(): Promise<void> {
  try {
    for (const g of await gruposAtivos()) {
      const r = await gerarGrupo(g.id, { id: g.executor_id, isAdmin: false }, { aceitarAvisos: true });
      if (!r.ok) console.log(`agenda: grupo ${g.nome} não estendido:`, 'erro' in r ? r.erro : 'conflitos pendentes');
      else if (r.criadas) console.log(`agenda: grupo ${g.nome} +${r.criadas} encontros`);
    }
  } catch (e) {
    console.error('agenda: estender grupos', e);
  }
}

export interface PreviaMatricula {
  sugestao: SugestaoEntrada;
  jornada: Jornada;
}

/** Sugestão de entrada + jornada (sem gravar). */
export async function previaMatricula(opts: { grupoId?: string; diaSemana?: number; aPartirDe?: Ymd }): Promise<PreviaMatricula | null> {
  const grupos = (await gruposAtivos()).map(paraConfig);
  if (!grupos.length) return null;
  const desde = opts.aPartirDe ?? localYmd(new Date(), FUSO);
  const feriados = await feriadosPeriodo(new Date(`${desde}T00:00:00Z`), new Date(Date.parse(`${addDays(desde, 400)}T00:00:00Z`)));
  const sugestao = sugerirEntrada(grupos, desde, feriados, { grupoId: opts.grupoId, diaSemana: opts.diaSemana });
  if (!sugestao) return null;
  return { sugestao, jornada: gerarJornada(grupos, sugestao.grupoId, sugestao.data, feriados) };
}

/**
 * Matricula o cliente no Impulsão: grava a jornada (1/N a N/N), garante os
 * encontros gerados até a conclusão e convida o cliente para eles.
 */
export async function matricular(
  tenantId: string,
  usuario: { id: string; isAdmin: boolean },
  opts: { grupoId?: string; diaSemana?: number; aPartirDe?: Ymd },
): Promise<{ ok: true; jornadaId: string; previa: PreviaMatricula } | { ok: false; erro: string; conflito?: RespostaConflito }> {
  const previa = await previaMatricula(opts);
  if (!previa) return { ok: false, erro: 'Nenhum grupo do Impulsão com Aula 1 disponível nas próximas semanas' };
  const { jornada } = previa;
  if (jornada.pendentes.length) return { ok: false, erro: 'A jornada não coube no horizonte da agenda' };

  const admin = createAdminSupabase();
  const grupos = await gruposAtivos();
  const fim = jornada.encontros[jornada.encontros.length - 1];
  for (const gid of new Set(jornada.encontros.map((e) => e.grupoId))) {
    const r = await gerarGrupo(gid, usuario, { ate: new Date(fim.fim.getTime() + 86_400_000), aceitarAvisos: true });
    if (!r.ok) return { ok: false, erro: 'erro' in r ? r.erro : 'O grupo tem conflitos na agenda: gere a agenda do grupo primeiro', ...('conflito' in r ? { conflito: r.conflito } : {}) };
  }

  // Encontros -> reuniões geradas do grupo naquela data.
  const { data: series } = await admin.from('agenda_series').select('id, grupo_id').in('grupo_id', [...new Set(jornada.encontros.map((e) => e.grupoId))]).is('encerrada_em', null);
  const seriePorGrupo = new Map(((series ?? []) as Array<{ id: string; grupo_id: string }>).map((s) => [s.grupo_id, s.id]));
  const meetings: Array<string | null> = [];
  for (const e of jornada.encontros) {
    const { data: oc } = await admin
      .from('agenda_ocorrencias')
      .select('meeting_id')
      .eq('serie_id', seriePorGrupo.get(e.grupoId) ?? '')
      .eq('inicio_original', e.inicio.toISOString())
      .maybeSingle();
    meetings.push((oc?.meeting_id as string | null) ?? null);
  }

  const grupo = grupos.find((g) => g.id === jornada.grupoInicialId)!;
  const { data: j, error } = await admin
    .from('agenda_jornadas')
    .insert({
      tenant_id: tenantId,
      produto: 'impulsao',
      grupo_id: jornada.grupoInicialId,
      executor_id: grupo.executor_id,
      inicio: jornada.encontros[0].data,
      fim_previsto: jornada.conclusao,
      encontros_previstos: jornada.encontros.length,
      criado_por: usuario.id,
    })
    .select('id')
    .single();
  if (error) return { ok: false, erro: error.message };
  await admin.from('agenda_jornada_encontros').insert(
    jornada.encontros.map((e, k) => ({
      jornada_id: j.id,
      numero: e.numero,
      rotulo: e.rotulo,
      data: e.data,
      grupo_id: e.grupoId,
      meeting_id: meetings[k],
      recuperacao: e.recuperacao,
    })),
  );

  // Convite do Google Agenda para o cliente nos encontros dele (não fatal).
  emSegundoPlano(async () => {
    try {
      const { data: t } = await admin.from('client_tenants').select('email').eq('id', tenantId).maybeSingle();
      const email = (t?.email as string | null)?.trim();
      if (!email) return;
      const ids = meetings.filter(Boolean) as string[];
      const { data: secs } = await admin.from('meet_meeting_sector').select('calendar_event_id').in('meeting_id', ids);
      for (const s of (secs ?? []) as Array<{ calendar_event_id: string | null }>) {
        if (s.calendar_event_id) await changeCalendarAttendees(s.calendar_event_id, { add: [email], remove: [] });
      }
    } catch (e) {
      console.error('agenda: convite da jornada', e);
    }
  });
  return { ok: true, jornadaId: j.id, previa };
}
