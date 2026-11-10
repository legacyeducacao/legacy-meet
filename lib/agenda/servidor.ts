/**
 * Servidor da agenda nova: acesso (flag), padrões da empresa, contexto do
 * executor para o motor e leitura das reuniões como eventos da tela.
 * Só roda no servidor (service_role).
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { CurrentUser } from '@/lib/auth';
import {
  expandirSerie,
  utcToLocal,
  EXPEDIENTE_PADRAO,
  feriadosNacionaisEntre,
  NIVEIS_PADRAO,
  REGRAS_PADRAO,
  type Bloqueio,
  type ContextoAgenda,
  type FaixaExpediente,
  type Feriado,
  type NivelRegra,
  type RegrasExecutor,
  type TipoConflito,
} from '@/lib/agenda-engine';
import type { Calendario, EventoDTO, FeriadoDTO, StatusReuniao } from './tipos';
import { sessaoParaEvento, type LinhaSessaoTurma } from './turmas';

export const FUSO = 'America/Sao_Paulo';

type Usuario = Pick<CurrentUser, 'id' | 'isAdmin'>;

/** Pode abrir a agenda nova? Admin sempre; demais com a flag ou com AGENDA_NOVA_TODOS=1. */
export async function podeUsarAgendaNova(user: Usuario | null): Promise<boolean> {
  if (!user) return false;
  if (user.isAdmin || process.env.AGENDA_NOVA_TODOS === '1') return true;
  const { data } = await createAdminSupabase()
    .from('meet_user_profile')
    .select('agenda_nova')
    .eq('user_id', user.id)
    .maybeSingle();
  return data?.agenda_nova === true;
}

export interface ConfigEmpresa {
  expediente: FaixaExpediente[];
  regras: RegrasExecutor;
  niveis: Record<TipoConflito, NivelRegra>;
  horizonteMeses: number;
  considerarFacultativos: boolean;
}

/** Padrões da empresa (agenda_config), com os valores padrão do plano. */
export async function carregarConfig(): Promise<ConfigEmpresa> {
  const { data } = await createAdminSupabase().from('agenda_config').select('chave, valor');
  const m = new Map(((data ?? []) as Array<{ chave: string; valor: unknown }>).map((r) => [r.chave, r.valor]));
  return {
    expediente: (m.get('expediente_padrao') as FaixaExpediente[] | undefined) ?? EXPEDIENTE_PADRAO,
    regras: { ...REGRAS_PADRAO, ...((m.get('regras_padrao') as Partial<RegrasExecutor> | undefined) ?? {}) },
    niveis: { ...NIVEIS_PADRAO, ...((m.get('niveis') as Partial<Record<TipoConflito, NivelRegra>> | undefined) ?? {}) },
    horizonteMeses: Number(m.get('horizonte_meses') ?? 6),
    considerarFacultativos: m.get('considerar_facultativos') !== false,
  };
}

/** Feriados válidos entre duas datas: nacionais calculados + cadastrados. */
export async function carregarFeriados(de: Date, ate: Date, cfg?: ConfigEmpresa): Promise<Feriado[]> {
  const conf = cfg ?? (await carregarConfig());
  const nacionais = feriadosNacionaisEntre(de.getUTCFullYear() - 1, ate.getUTCFullYear() + 1).filter(
    (f) => conf.considerarFacultativos || !f.facultativo,
  );
  const { data } = await createAdminSupabase()
    .from('agenda_feriados')
    .select('data, nome, escopo, uf, municipio')
    .gte('data', `${de.getUTCFullYear() - 1}-01-01`)
    .lte('data', `${ate.getUTCFullYear() + 1}-12-31`);
  return [...nacionais, ...((data ?? []) as Feriado[])];
}

function pick<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export function calendarioDe(setor: string | null | undefined, produto: string | null | undefined): Calendario {
  if (setor === 'comercial') return 'comercial';
  if (produto === 'impulsao_empresarial') return 'impulsao';
  if (produto?.startsWith('legado')) return 'legado';
  return 'outros';
}

const SELECT_REUNIAO =
  'id, title, host_id, status, scheduled_start_at, scheduled_end_at, room_name, recording_enabled, auto_transcribe, recurrence_parent_id, tenant_id, users:host_id(name), client_tenants:tenant_id(name, produto), meet_meeting_sector!inner(sector, onboarding), meet_meeting_hosts(user_id)';

type LinhaReuniao = {
  id: string;
  title: string | null;
  host_id: string;
  status: StatusReuniao;
  scheduled_start_at: string;
  scheduled_end_at: string | null;
  room_name: string;
  recording_enabled: boolean | null;
  auto_transcribe: boolean | null;
  recurrence_parent_id: string | null;
  tenant_id: string | null;
  users: { name: string | null } | null;
  client_tenants: { name: string | null; produto: string | null } | null;
  meet_meeting_sector: { sector: string; onboarding: boolean } | { sector: string; onboarding: boolean }[];
  meet_meeting_hosts: { user_id: string }[] | null;
};

export function reuniaoParaEvento(r: LinhaReuniao, user: Usuario, rotulo?: string | null): EventoDTO {
  const sec = pick(r.meet_meeting_sector);
  const inicio = new Date(r.scheduled_start_at);
  const fim = r.scheduled_end_at ? new Date(r.scheduled_end_at) : new Date(inicio.getTime() + 3_600_000);
  return {
    id: r.id,
    tipo: 'reuniao',
    titulo: r.title?.trim() || 'Reunião',
    inicio: inicio.toISOString(),
    fim: (fim > inicio ? fim : new Date(inicio.getTime() + 3_600_000)).toISOString(),
    calendario: calendarioDe(sec?.sector, r.client_tenants?.produto),
    status: r.status,
    roomName: r.room_name,
    executorId: r.host_id,
    executorNome: r.users?.name ?? null,
    cliente: r.client_tenants?.name?.trim() || null,
    tenantId: r.tenant_id,
    setor: (sec?.sector as 'executoria' | 'comercial' | undefined) ?? null,
    serieId: r.recurrence_parent_id,
    rotulo: rotulo ?? null,
    gravar: r.recording_enabled !== false,
    transcrever: r.auto_transcribe !== false,
    onboarding: sec?.onboarding === true,
    podeEditar: r.status === 'scheduled' && (user.isAdmin || r.host_id === user.id),
  };
}

/**
 * Reuniões (não canceladas) dos executores no período, mais as em que o
 * usuário é anfitrião adicional. Inclui o rótulo do ciclo (F1, F2...) quando
 * a reunião veio de uma série da agenda nova.
 */
export async function listarReunioes(user: Usuario, executores: string[], de: Date, ate: Date): Promise<EventoDTO[]> {
  const admin = createAdminSupabase();
  // Margem de 1 dia para reuniões que começam antes e terminam dentro do período.
  const deIso = new Date(de.getTime() - 86_400_000).toISOString();
  const ateIso = ate.toISOString();
  const base = () =>
    admin
      .from('meetings')
      .select(SELECT_REUNIAO)
      .neq('status', 'canceled')
      .gte('scheduled_start_at', deIso)
      .lt('scheduled_start_at', ateIso)
      .order('scheduled_start_at')
      .limit(3000);

  const [donos, coAnfitriao] = await Promise.all([
    base().in('host_id', executores),
    executores.includes(user.id)
      ? admin.from('meet_meeting_hosts').select('meeting_id').eq('user_id', user.id)
      : Promise.resolve({ data: [] as { meeting_id: string }[] }),
  ]);
  if (donos.error) throw new Error(donos.error.message);
  let linhas = (donos.data ?? []) as unknown as LinhaReuniao[];
  const extras = ((coAnfitriao.data ?? []) as { meeting_id: string }[]).map((x) => x.meeting_id);
  if (extras.length) {
    const { data } = await base().in('id', extras.slice(0, 500));
    const vistos = new Set(linhas.map((l) => l.id));
    linhas = [...linhas, ...((data ?? []) as unknown as LinhaReuniao[]).filter((l) => !vistos.has(l.id))];
  }

  const ids = linhas.map((l) => l.id);
  const rotulos = new Map<string, string | null>();
  const deGrupo = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from('agenda_ocorrencias')
      .select('meeting_id, rotulo, agenda_series(grupo_id)')
      .in('meeting_id', ids.slice(i, i + 200));
    for (const o of (data ?? []) as unknown as Array<{ meeting_id: string; rotulo: string | null; agenda_series: { grupo_id: string | null } | null }>) {
      rotulos.set(o.meeting_id, o.rotulo);
      if (pick(o.agenda_series)?.grupo_id) deGrupo.add(o.meeting_id);
    }
  }
  return linhas
    .filter((l) => new Date(l.scheduled_end_at ?? l.scheduled_start_at).getTime() > de.getTime())
    .map((l) => {
      const ev = reuniaoParaEvento(l, user, rotulos.get(l.id));
      // Encontro de grupo do Impulsão (o cliente da reunião é o da Legacy).
      return deGrupo.has(l.id) ? { ...ev, calendario: 'impulsao' as const } : ev;
    });
}

type LinhaBloqueio = { id: string; executor_id: string; inicio: string; fim: string; dia_inteiro: boolean; motivo: string | null; rrule: string | null; fuso: string | null };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Bloqueios do período, com os recorrentes (rrule) expandidos em cada data. */
export async function buscarBloqueios(executores: string[], de: Date, ate: Date): Promise<Array<LinhaBloqueio & { ocorrencia: number }>> {
  const admin = createAdminSupabase();
  const [simples, recorrentes] = await Promise.all([
    admin.from('agenda_bloqueios').select('*').in('executor_id', executores).is('rrule', null).lt('inicio', ate.toISOString()).gt('fim', de.toISOString()),
    admin.from('agenda_bloqueios').select('*').in('executor_id', executores).not('rrule', 'is', null).lt('inicio', ate.toISOString()),
  ]);
  const out: Array<LinhaBloqueio & { ocorrencia: number }> = ((simples.data ?? []) as LinhaBloqueio[]).map((b) => ({ ...b, ocorrencia: 0 }));
  for (const b of (recorrentes.data ?? []) as LinhaBloqueio[]) {
    const ini = new Date(b.inicio);
    const l = utcToLocal(ini, b.fuso || FUSO);
    try {
      const ocs = expandirSerie(
        {
          rrule: b.rrule!,
          inicioLocal: `${l.year}-${pad2(l.month)}-${pad2(l.day)}T${pad2(l.hour)}:${pad2(l.minute)}`,
          fuso: b.fuso || FUSO,
          duracaoMin: Math.max(1, Math.round((Date.parse(b.fim) - ini.getTime()) / 60_000)),
        },
        { de, ate },
        { maxOcorrencias: 2000 },
      );
      ocs.forEach((o, k) => out.push({ ...b, inicio: o.inicio.toISOString(), fim: o.fim.toISOString(), ocorrencia: k }));
    } catch (e) {
      console.error('agenda: bloqueio recorrente inválido', b.id, e);
    }
  }
  return out;
}

/** Bloqueios no período. O motivo só vai para o próprio executor e para admin. */
export async function listarBloqueios(user: Usuario, executores: string[], de: Date, ate: Date): Promise<EventoDTO[]> {
  return (await buscarBloqueios(executores, de, ate)).map(
    (b) => {
      const dono = b.executor_id === user.id || user.isAdmin;
      return {
        id: `bloqueio:${b.id}:${b.ocorrencia}`,
        tipo: 'bloqueio' as const,
        titulo: dono ? b.motivo?.trim() || 'Bloqueado' : 'Indisponível',
        inicio: new Date(b.inicio).toISOString(),
        fim: new Date(b.fim).toISOString(),
        diaInteiro: b.dia_inteiro,
        calendario: 'bloqueios' as const,
        executorId: b.executor_id,
        podeEditar: dono,
      };
    },
  );
}

/**
 * Encontros das Turmas do Legado no período (turmas publicadas, sessões não
 * arquivadas). Só leitura: as tabelas cohort_* são do Legacy Plan.
 */
export async function listarTurmas(de: Date, ate: Date): Promise<EventoDTO[]> {
  const admin = createAdminSupabase();
  // Turma arquivada no Plan (ex.: turmas de teste) não aparece, mesmo com o cronograma publicado.
  const { data: arquivadas } = await admin.from('cohorts').select('name').not('archived_at', 'is', null);
  const fora = new Set(((arquivadas ?? []) as Array<{ name: string | null }>).map((c) => c.name?.trim()).filter(Boolean));
  const { data, error } = await admin
    .from('cohort_sessions')
    .select(
      'id, scheduled_start_at, scheduled_end_at, title, modality, location, meeting_url, zoom_meeting_id, cohort_schedules!inner(cohort_name, published)',
    )
    .is('archived_at', null)
    .eq('cohort_schedules.published', true)
    // Margem de 1 dia para encontros que começam antes e terminam dentro do período.
    .gte('scheduled_start_at', new Date(de.getTime() - 86_400_000).toISOString())
    .lt('scheduled_start_at', ate.toISOString())
    .order('scheduled_start_at')
    .limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as LinhaSessaoTurma[])
    .filter((r) => {
      const t = Array.isArray(r.cohort_schedules) ? r.cohort_schedules[0] : r.cohort_schedules;
      return !fora.has(t?.cohort_name?.trim() ?? '');
    })
    .map(sessaoParaEvento)
    .filter((e) => Date.parse(e.fim) > de.getTime());
}

export function feriadosParaDTO(feriados: Feriado[], de: Date, ate: Date): FeriadoDTO[] {
  const a = de.toISOString().slice(0, 10);
  const b = ate.toISOString().slice(0, 10);
  const vistos = new Set<string>();
  return feriados
    .filter((f) => f.data >= a && f.data <= b)
    .filter((f) => (vistos.has(f.data) ? false : (vistos.add(f.data), true)))
    .map((f) => ({ data: f.data, nome: f.nome, escopo: f.escopo, facultativo: f.facultativo }));
}

/** Contexto do motor para validar a agenda de um executor. */
export async function contextoExecutor(
  executorId: string,
  de: Date,
  ate: Date,
  cfg?: ConfigEmpresa,
): Promise<ContextoAgenda> {
  const conf = cfg ?? (await carregarConfig());
  const admin = createAdminSupabase();
  const [exp, regras, bloqueios, reunioes, feriados] = await Promise.all([
    admin.from('agenda_expediente').select('dia_semana, inicio, fim').eq('executor_id', executorId),
    admin.from('agenda_regras_executor').select('*').eq('executor_id', executorId).maybeSingle(),
    buscarBloqueios([executorId], de, ate),
    admin
      .from('meetings')
      .select('id, title, scheduled_start_at, scheduled_end_at')
      .eq('host_id', executorId)
      .in('status', ['scheduled', 'live'])
      .gte('scheduled_start_at', new Date(de.getTime() - 86_400_000).toISOString())
      .lt('scheduled_start_at', ate.toISOString()),
    carregarFeriados(de, ate, conf),
  ]);

  const faixas = ((exp.data ?? []) as Array<{ dia_semana: number; inicio: string; fim: string }>).map((f) => ({
    diaSemana: f.dia_semana,
    inicio: f.inicio,
    fim: f.fim,
  }));
  const r = regras.data as
    | { buffer_min: number | null; max_reunioes_dia: number | null; max_horas_dia: number | null; max_horas_semana: number | null; uf: string | null; municipio: string | null }
    | null;
  // O executor pode aumentar o próprio buffer, nunca baixar do mínimo da empresa.
  const bufferMin = Math.max(conf.regras.bufferMin, r?.buffer_min ?? 0);
  return {
    fuso: FUSO,
    expediente: faixas.length ? faixas : conf.expediente,
    bloqueios: bloqueios.map((b): Bloqueio => ({ id: b.id, inicio: new Date(b.inicio), fim: new Date(b.fim) })),
    eventos: ((reunioes.data ?? []) as Array<{ id: string; title: string | null; scheduled_start_at: string; scheduled_end_at: string | null }>).map((m) => {
      const inicio = new Date(m.scheduled_start_at);
      const fim = m.scheduled_end_at ? new Date(m.scheduled_end_at) : new Date(inicio.getTime() + 3_600_000);
      return { id: m.id, inicio, fim: fim > inicio ? fim : new Date(inicio.getTime() + 3_600_000), titulo: m.title ?? undefined };
    }),
    feriados,
    filtroFeriados: { uf: r?.uf ?? null, municipio: r?.municipio ?? null },
    regras: {
      bufferMin,
      maxReunioesDia: r?.max_reunioes_dia ?? conf.regras.maxReunioesDia,
      maxHorasDia: r?.max_horas_dia ?? conf.regras.maxHorasDia,
      maxHorasSemana: r?.max_horas_semana ?? conf.regras.maxHorasSemana,
      niveis: conf.niveis,
    },
  };
}

export async function registrarSobreposicoes(
  conflitos: Array<{ tipo: string; nivel: string; detalhe: string; ref: string }>,
  usuarioId: string,
  justificativa: string,
  meetingPorRef: (ref: string) => string | null,
  serieId?: string | null,
): Promise<void> {
  if (!conflitos.length) return;
  await createAdminSupabase()
    .from('agenda_overrides_log')
    .insert(
      conflitos.map((c) => ({
        regra: c.tipo,
        nivel: c.nivel,
        meeting_id: meetingPorRef(c.ref),
        serie_id: serieId ?? null,
        usuario_id: usuarioId,
        justificativa,
        detalhes: { detalhe: c.detalhe },
      })),
    );
}
