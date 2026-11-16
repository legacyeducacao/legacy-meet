/**
 * Reservas do kickoff (M2) no servidor (service_role). Toda escrita passa pelas
 * funções do banco (integracoes/kickoff/003_kickoff_reservas.sql), que conferem
 * de novo a permissão do usuário e aplicam as regras com trava. O usuário vem
 * sempre da sessão do servidor, nunca do pedido.
 *
 * Leituras toleram a migration 003 ainda não aplicada: sem reservas, sem erro.
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { organizadorDoKickoff } from './regras';
import { erroDoBanco, validarParticipante, type Presenca, type StatusReserva } from './reservasRegras';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export type Resultado<T> = { ok: true; dados: T } | { ok: false; status: number; message: string };

const falhou = (status: number, message: string) => ({ ok: false as const, status, message });

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<Resultado<T>> {
  const { data, error } = await createAdminSupabase().rpc(fn, args);
  if (error) return { ok: false, ...erroDoBanco(error) };
  return { ok: true, dados: data as T };
}

/** Empresas internas que nunca são participantes (organizadora e sentinela do Comercial). */
export function empresasInternas(env: Record<string, string | undefined> = process.env): string[] {
  const ids = [organizadorDoKickoff(env), env.MEET_COMMERCIAL_TENANT_ID?.trim().toLowerCase()];
  return ids.filter((x): x is string => !!x);
}

export interface ReservaDTO {
  id: string;
  sessaoId: string;
  empresa: { id: string; nome: string };
  participante: { nome: string; email: string; telefone: string | null };
  status: StatusReserva;
  /** Comparecimento registrado (não é conclusão). */
  presenca: Presenca | null;
  presencaEm: string | null;
  /** Quem registrou a presença: à mão ou pela sincronização do Zoom (E3). */
  presencaOrigem: 'manual' | 'zoom' | null;
  concluidaEm: string | null;
  /** Participação não concluída: quando e por quê. */
  interrompidaEm: string | null;
  motivoInterrupcao: string | null;
  /** Reserva ausente ou interrompida que esta reagendou. */
  origemReservaId: string | null;
  /** Esta ausência/interrupção já foi reagendada. */
  reagendada: boolean;
  criadoEm: string;
  atualizadoEm: string;
  canceladaEm: string | null;
  motivoCancelamento: string | null;
}

type LinhaReserva = {
  id: string;
  meeting_id: string;
  tenant_id: string;
  participante_nome: string;
  participante_email: string;
  participante_telefone: string | null;
  status: StatusReserva;
  presenca: Presenca | null;
  presenca_em: string | null;
  presenca_origem?: 'manual' | 'zoom' | null;
  concluida_em: string | null;
  interrompida_em: string | null;
  motivo_interrupcao: string | null;
  origem_reserva_id: string | null;
  criado_em: string;
  atualizado_em: string;
  cancelada_em: string | null;
  motivo_cancelamento: string | null;
  client_tenants: { name: string | null } | Array<{ name: string | null }> | null;
};

const paraDTO = (l: LinhaReserva, reagendadas: Set<string>): ReservaDTO => {
  const t = Array.isArray(l.client_tenants) ? l.client_tenants[0] : l.client_tenants;
  return {
    id: l.id,
    sessaoId: l.meeting_id,
    empresa: { id: l.tenant_id, nome: t?.name?.trim() || 'Empresa' },
    participante: { nome: l.participante_nome, email: l.participante_email, telefone: l.participante_telefone },
    status: l.status,
    presenca: l.presenca,
    presencaEm: l.presenca_em,
    presencaOrigem: l.presenca_origem ?? null,
    concluidaEm: l.concluida_em,
    interrompidaEm: l.interrompida_em,
    motivoInterrupcao: l.motivo_interrupcao,
    origemReservaId: l.origem_reserva_id,
    reagendada: reagendadas.has(l.id),
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    canceladaEm: l.cancelada_em,
    motivoCancelamento: l.motivo_cancelamento,
  };
};

/** A estrutura das reservas existe no banco? */
export async function estruturaDasReservas(): Promise<'ok' | 'pendente'> {
  const { error } = await createAdminSupabase().from('agenda_kickoff_reservas').select('id').limit(1);
  return error ? 'pendente' : 'ok';
}

/** Reservas (todas, inclusive canceladas) das sessões. null = estrutura pendente. */
export async function listarReservas(sessaoIds: string[]): Promise<ReservaDTO[] | null> {
  if (!sessaoIds.length) return [];
  try {
    return await listarReservasEmLotes(sessaoIds);
  } catch {
    return null;
  }
}

async function listarReservasEmLotes(sessaoIds: string[]): Promise<ReservaDTO[] | null> {
  const admin = createAdminSupabase();
  const linhas: LinhaReserva[] = [];
  for (let i = 0; i < sessaoIds.length; i += 200) {
    const { data, error } = await admin
      .from('agenda_kickoff_reservas')
      .select(
        'id, meeting_id, tenant_id, participante_nome, participante_email, participante_telefone, status, presenca, presenca_em, presenca_origem, concluida_em, interrompida_em, motivo_interrupcao, origem_reserva_id, criado_em, atualizado_em, cancelada_em, motivo_cancelamento, client_tenants(name)',
      )
      .in('meeting_id', sessaoIds.slice(i, i + 200))
      .order('criado_em');
    if (error) return null;
    linhas.push(...((data ?? []) as unknown as LinhaReserva[]));
  }
  // Ausências e interrupções já reagendadas (a reserva nova pode estar em sessão fora do período).
  const ausentes = linhas.filter((l) => l.status === 'ausente' || l.status === 'interrompida').map((l) => l.id);
  const reagendadas = new Set<string>();
  if (ausentes.length) {
    const { data } = await admin.from('agenda_kickoff_reservas').select('origem_reserva_id').in('origem_reserva_id', ausentes);
    for (const r of (data ?? []) as Array<{ origem_reserva_id: string }>) reagendadas.add(r.origem_reserva_id);
  }
  return linhas.map((l) => paraDTO(l, reagendadas));
}

/** Vagas ocupadas por sessão (reservas não canceladas), para a agenda. Estrutura pendente = vazio. */
export async function ocupacaoDasSessoes(sessaoIds: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  try {
    const admin = createAdminSupabase();
    for (let i = 0; i < sessaoIds.length; i += 200) {
      const { data, error } = await admin
        .from('agenda_kickoff_reservas')
        .select('meeting_id')
        .neq('status', 'cancelada')
        .in('meeting_id', sessaoIds.slice(i, i + 200));
      if (error) return mapa;
      for (const r of (data ?? []) as Array<{ meeting_id: string }>) mapa.set(r.meeting_id, (mapa.get(r.meeting_id) ?? 0) + 1);
    }
  } catch {
    // Só a indicação de ocupação: sem ela, a agenda continua funcionando.
  }
  return mapa;
}

/** Sessões (entre as informadas) que têm alguma reserva, ativa ou cancelada. */
export async function sessoesComReservas(sessaoIds: string[], soAtivas = false): Promise<string[]> {
  if (!sessaoIds.length) return [];
  let q = createAdminSupabase().from('agenda_kickoff_reservas').select('meeting_id').in('meeting_id', sessaoIds);
  if (soAtivas) q = q.eq('status', 'ativa');
  const { data, error } = await q;
  if (error) return [];
  return [...new Set(((data ?? []) as Array<{ meeting_id: string }>).map((r) => r.meeting_id))];
}

export interface EmpresaBusca {
  id: string;
  nome: string;
  produto: string | null;
  /** Reserva ativa da empresa, se houver (uma por empresa). */
  reservaAtiva: { reservaId: string; sessaoId: string } | null;
  /** Kickoff já concluído (a empresa não reserva outro). */
  concluida: boolean;
  /** Já faltou ou não concluiu um kickoff (pode reservar; a reserva nova fica ligada à anterior). */
  ausente: boolean;
}

/** Busca de empresas para inscrever (só gestores; nunca em rota pública). */
export async function buscarEmpresas(termo: string): Promise<EmpresaBusca[]> {
  const t = termo.trim().slice(0, 80);
  if (t.length < 2) return [];
  const padrao = `%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const admin = createAdminSupabase();
  let q = admin.from('client_tenants').select('id, name, produto').ilike('name', padrao).order('name').limit(20);
  const internas = empresasInternas();
  if (internas.length) q = q.not('id', 'in', `(${internas.join(',')})`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const empresas = (data ?? []) as Array<{ id: string; name: string | null; produto: string | null }>;
  const ativas = new Map<string, { reservaId: string; sessaoId: string }>();
  const concluidas = new Set<string>();
  const ausentes = new Set<string>();
  if (empresas.length) {
    const { data: rs } = await admin
      .from('agenda_kickoff_reservas')
      .select('id, meeting_id, tenant_id, status')
      .in('status', ['ativa', 'concluida', 'ausente', 'interrompida'])
      .in('tenant_id', empresas.map((e) => e.id));
    for (const r of (rs ?? []) as Array<{ id: string; meeting_id: string; tenant_id: string; status: StatusReserva }>) {
      if (r.status === 'ativa') ativas.set(r.tenant_id, { reservaId: r.id, sessaoId: r.meeting_id });
      if (r.status === 'concluida') concluidas.add(r.tenant_id);
      if (r.status === 'ausente' || r.status === 'interrompida') ausentes.add(r.tenant_id);
    }
  }
  return empresas.map((e) => ({
    id: e.id,
    nome: e.name?.trim() || 'Empresa',
    produto: e.produto,
    reservaAtiva: ativas.get(e.id) ?? null,
    concluida: concluidas.has(e.id),
    ausente: ausentes.has(e.id),
  }));
}

export interface EventoHistorico {
  acao:
    | 'criada'
    | 'reagendada'
    | 'remanejada'
    | 'cancelada'
    | 'participante_alterado'
    | 'presenca_registrada'
    | 'ausente'
    | 'concluida'
    | 'interrompida'
    | 'presenca_corrigida';
  em: string;
  usuario: string | null;
  motivo: string | null;
  sessaoDe: { id: string; inicio: string | null } | null;
  sessaoPara: { id: string; inicio: string | null } | null;
  dados: {
    antes?: Record<string, string | null>;
    depois?: Record<string, string | null>;
    presenca?: string;
    origem?: string;
    de_reserva?: string;
  } | null;
}

/** Histórico de uma reserva, com nomes de quem fez e horários das sessões. */
export async function historicoDaReserva(reservaId: string): Promise<EventoHistorico[] | null> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from('agenda_kickoff_reservas_historico')
    .select('acao, em, usuario_id, motivo, sessao_de, sessao_para, dados')
    .eq('reserva_id', reservaId)
    .order('id');
  if (error) return null;
  type Linha = {
    acao: EventoHistorico['acao'];
    em: string;
    usuario_id: string | null;
    motivo: string | null;
    sessao_de: string | null;
    sessao_para: string | null;
    dados: EventoHistorico['dados'];
  };
  const linhas = (data ?? []) as Linha[];
  const usuarios = [...new Set(linhas.map((l) => l.usuario_id).filter((x): x is string => !!x))];
  const sessoes = [...new Set(linhas.flatMap((l) => [l.sessao_de, l.sessao_para]).filter((x): x is string => !!x))];
  const [{ data: us }, { data: ms }] = await Promise.all([
    usuarios.length ? admin.from('users').select('id, name').in('id', usuarios) : Promise.resolve({ data: [] }),
    sessoes.length ? admin.from('meetings').select('id, scheduled_start_at').in('id', sessoes) : Promise.resolve({ data: [] }),
  ]);
  const nome = new Map(((us ?? []) as Array<{ id: string; name: string | null }>).map((u) => [u.id, u.name]));
  const inicio = new Map(((ms ?? []) as Array<{ id: string; scheduled_start_at: string }>).map((m) => [m.id, m.scheduled_start_at]));
  const sessao = (id: string | null) => (id ? { id, inicio: inicio.get(id) ?? null } : null);
  return linhas.map((l) => ({
    acao: l.acao,
    em: l.em,
    usuario: l.usuario_id ? (nome.get(l.usuario_id) ?? null) : null,
    motivo: l.motivo,
    sessaoDe: sessao(l.sessao_de),
    sessaoPara: sessao(l.sessao_para),
    dados: l.dados,
  }));
}

// ---------------------------------------------------------------------------
// Escritas (sempre pelas funções do banco)
// ---------------------------------------------------------------------------

export async function reservar(
  usuarioId: string,
  pedido: { sessaoId?: unknown; tenantId?: unknown; nome?: unknown; email?: unknown; telefone?: unknown },
): Promise<Resultado<{ id: string }>> {
  if (!ehUuid(pedido.sessaoId)) return falhou(400, 'Escolha a sessão');
  if (!ehUuid(pedido.tenantId)) return falhou(400, 'Escolha a empresa');
  if (empresasInternas().includes(pedido.tenantId.toLowerCase())) {
    return falhou(422, 'Empresa interna da Legacy não pode ser inscrita como participante.');
  }
  const v = validarParticipante(pedido);
  if (!v.ok) return falhou(400, v.message);
  return rpc('agenda_kickoff_reservar', {
    p_meeting_id: pedido.sessaoId,
    p_tenant_id: pedido.tenantId,
    p_nome: v.participante.nome,
    p_email: v.participante.email,
    p_telefone: v.participante.telefone,
    p_usuario: usuarioId,
  });
}

export async function remanejar(usuarioId: string, reservaId: string, sessaoId: unknown, motivo: unknown) {
  if (!ehUuid(reservaId)) return falhou(404, 'Reserva não encontrada.');
  if (!ehUuid(sessaoId)) return falhou(400, 'Escolha a sessão de destino');
  return rpc<{ id: string }>('agenda_kickoff_remanejar', {
    p_reserva_id: reservaId,
    p_para_meeting_id: sessaoId,
    p_motivo: typeof motivo === 'string' ? motivo.slice(0, 500) : null,
    p_usuario: usuarioId,
  });
}

export async function cancelarReserva(usuarioId: string, reservaId: string, motivo: unknown) {
  if (!ehUuid(reservaId)) return falhou(404, 'Reserva não encontrada.');
  return rpc<{ id: string }>('agenda_kickoff_cancelar_reserva', {
    p_reserva_id: reservaId,
    p_motivo: typeof motivo === 'string' ? motivo.slice(0, 500) : null,
    p_usuario: usuarioId,
  });
}

export async function atualizarParticipante(usuarioId: string, reservaId: string, pedido: { nome?: unknown; email?: unknown; telefone?: unknown }) {
  if (!ehUuid(reservaId)) return falhou(404, 'Reserva não encontrada.');
  const v = validarParticipante(pedido);
  if (!v.ok) return falhou(400, v.message);
  return rpc<{ id: string }>('agenda_kickoff_atualizar_participante', {
    p_reserva_id: reservaId,
    p_nome: v.participante.nome,
    p_email: v.participante.email,
    p_telefone: v.participante.telefone,
    p_usuario: usuarioId,
  });
}

export async function configurarSessao(usuarioId: string, sessaoId: string, pedido: { capacidade?: unknown; aceitaReservas?: unknown }) {
  if (!ehUuid(sessaoId)) return falhou(404, 'Sessão de kickoff não encontrada.');
  const capacidade = pedido.capacidade === undefined || pedido.capacidade === null ? null : Number(pedido.capacidade);
  if (capacidade !== null && (!Number.isInteger(capacidade) || capacidade < 1 || capacidade > 50)) {
    return falhou(400, 'A capacidade deve ser de 1 a 50 empresas.');
  }
  const aceita = typeof pedido.aceitaReservas === 'boolean' ? pedido.aceitaReservas : null;
  if (capacidade === null && aceita === null) return falhou(400, 'Nada para alterar');
  return rpc('agenda_kickoff_configurar_sessao', {
    p_meeting_id: sessaoId,
    p_capacidade: capacidade,
    p_aceita_reservas: aceita,
    p_usuario: usuarioId,
  });
}

export async function cancelarSessoes(
  usuarioId: string,
  ids: string[],
  opcoes: { comReservas: boolean; motivo?: string | null; origem?: string },
) {
  // Os ids vêm do banco (resolverAlvos) ou de uma rota que já validou o formato.
  if (!ids.length) return falhou(404, 'Sessão de kickoff não encontrada.');
  return rpc<{ sessoes: string[]; reservasCanceladas: number }>('agenda_kickoff_cancelar_sessoes', {
    p_ids: ids,
    p_cancelar_reservas: opcoes.comReservas,
    p_motivo: opcoes.motivo?.slice(0, 400) ?? null,
    p_origem: opcoes.origem ?? 'legacy',
    p_usuario: usuarioId,
  });
}

export async function remarcarSessoes(
  usuarioId: string,
  itens: Array<{ id: string; inicio: string; fim: string; titulo?: string | null }>,
) {
  return rpc<number>('agenda_kickoff_remarcar_sessoes', { p_itens: itens, p_usuario: usuarioId });
}

/** Comparecimento manual (check-in): 'presente' depois do início, 'ausente' depois do fim. Não conclui. */
export async function registrarPresenca(usuarioId: string, reservaId: string, presenca: unknown) {
  if (!ehUuid(reservaId)) return falhou(404, 'Reserva não encontrada.');
  if (presenca !== 'presente' && presenca !== 'ausente') return falhou(400, 'Presença inválida');
  return rpc<{ id: string }>('agenda_kickoff_registrar_presenca', { p_reserva_id: reservaId, p_presenca: presenca, p_usuario: usuarioId });
}

/** Conclusão do kickoff: ato explícito, só com presença 'presente'. Definitiva. */
export async function concluirKickoff(usuarioId: string, reservaId: string, observacao: unknown) {
  if (!ehUuid(reservaId)) return falhou(404, 'Reserva não encontrada.');
  return rpc<{ id: string }>('agenda_kickoff_concluir', {
    p_reserva_id: reservaId,
    p_observacao: typeof observacao === 'string' ? observacao.slice(0, 500) : null,
    p_usuario: usuarioId,
  });
}

/** Reagenda uma ausência: reserva nova na sessão escolhida, ligada à ausência. */
export async function reagendar(usuarioId: string, reservaId: string, sessaoId: unknown, motivo: unknown) {
  if (!ehUuid(reservaId)) return falhou(404, 'Reserva não encontrada.');
  if (!ehUuid(sessaoId)) return falhou(400, 'Escolha a sessão');
  return rpc<{ id: string }>('agenda_kickoff_reagendar', {
    p_reserva_ausente_id: reservaId,
    p_para_meeting_id: sessaoId,
    p_motivo: typeof motivo === 'string' ? motivo.slice(0, 500) : null,
    p_usuario: usuarioId,
  });
}

/** Participação não concluída (interrupção): motivo obrigatório; libera para reagendar. */
export async function registrarInterrupcao(usuarioId: string, reservaId: string, motivo: unknown) {
  if (!ehUuid(reservaId)) return falhou(404, 'Reserva não encontrada.');
  const m = typeof motivo === 'string' ? motivo.trim().slice(0, 500) : '';
  if (!m) return falhou(400, 'Informe o motivo da participação não concluída.');
  return rpc<{ id: string }>('agenda_kickoff_registrar_interrupcao', { p_reserva_id: reservaId, p_motivo: m, p_usuario: usuarioId });
}

/** Correção de presença/ausência registrada por engano: motivo obrigatório; mesma reserva. */
export async function corrigirPresenca(usuarioId: string, reservaId: string, presenca: unknown, motivo: unknown) {
  if (!ehUuid(reservaId)) return falhou(404, 'Reserva não encontrada.');
  if (presenca !== 'presente' && presenca !== 'ausente' && presenca !== 'nenhuma') return falhou(400, 'Presença inválida');
  const m = typeof motivo === 'string' ? motivo.trim().slice(0, 500) : '';
  if (!m) return falhou(400, 'Informe o motivo da correção.');
  return rpc<{ id: string }>('agenda_kickoff_corrigir_presenca', {
    p_reserva_id: reservaId,
    p_presenca: presenca,
    p_motivo: m,
    p_usuario: usuarioId,
  });
}
