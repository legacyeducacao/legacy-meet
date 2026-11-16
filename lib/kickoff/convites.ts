/**
 * Convites do kickoff (M3) no servidor (service_role). Toda escrita e toda leitura
 * pública passam pelas funções do banco (integracoes/kickoff/005_kickoff_convites.sql).
 *
 * Público: o código vem da URL e a origem vem do servidor (hash do IP). A empresa
 * sai sempre do convite, nunca do pedido. A resposta ao visitante é montada aqui,
 * campo a campo, a partir do que o banco devolve: nada além do contrato público.
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { erroDoBanco } from './reservasRegras';
import { ehUuid, empresasInternas, type Resultado } from './reservas';
import { enderecoPublico, linkOficial } from './enderecoPublico';
import {
  RECUSAS,
  dentroDaAntecedencia,
  ehCodigoDeConvite,
  linkDoAgendamento,
  type AnfitriaoPublico,
  type PaginaDoConvite,
  type RecusaDoConvite,
  type ReservaPublica,
  type RespostaDoAgendamento,
  type RespostaDoConvite,
  type SessaoPublica,
  type StatusDoAgendamento,
} from './publico';

const falhou = (status: number, message: string) => ({ ok: false as const, status, message });

// ---------------------------------------------------------------------------
// Saneamento do que vai para o visitante (só os campos do contrato público)
// ---------------------------------------------------------------------------

const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Só a foto do bucket PÚBLICO de avatares do Supabase (mesma regra do banco). */
const FOTO_PUBLICA = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/avatars\/[^?#\s]+$/;

function anfitriao(v: unknown): AnfitriaoPublico | null {
  const a = v as { nome?: unknown; foto?: unknown } | null;
  if (!a || typeof a !== 'object') return null;
  const foto = typeof a.foto === 'string' && FOTO_PUBLICA.test(a.foto) ? a.foto.slice(0, 500) : null;
  return { nome: texto(a.nome) || 'Equipe Legacy', foto };
}

function reserva(v: unknown): ReservaPublica | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  return {
    data: texto(r.data, 10),
    inicio: texto(r.inicio, 5),
    fim: texto(r.fim, 5),
    starts_at: texto(r.starts_at, 40),
    participante: texto(r.participante),
    anfitriao: anfitriao(r.anfitriao),
  };
}

function sessao(v: unknown): SessaoPublica | null {
  const s = v as Record<string, unknown> | null;
  if (!s || typeof s !== 'object' || !ehUuid(s.id)) return null;
  return {
    id: s.id,
    data: texto(s.data, 10),
    inicio: texto(s.inicio, 5),
    fim: texto(s.fim, 5),
    starts_at: texto(s.starts_at, 40),
    vagas: typeof s.vagas === 'number' ? s.vagas : 0,
    anfitriao: anfitriao(s.anfitriao),
  };
}

const ehRecusa = (s: unknown): s is RecusaDoConvite => RECUSAS.includes(s as RecusaDoConvite);

export function paginaPublica(bruto: unknown): RespostaDoConvite | null {
  const b = bruto as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  if (ehRecusa(b.status)) return { status: b.status };
  if (b.status !== 'ok') return null;
  const situacao = b.situacao === 'reservada' || b.situacao === 'concluida' ? b.situacao : 'disponivel';
  const pagina: PaginaDoConvite = {
    status: 'ok',
    empresa: { nome: texto((b.empresa as { nome?: unknown } | null)?.nome) || 'Sua empresa' },
    situacao,
    expirado: b.expirado === true,
    reserva: reserva(b.reserva),
    sessoes: Array.isArray(b.sessoes) ? b.sessoes.map(sessao).filter((x): x is SessaoPublica => x !== null) : [],
  };
  return pagina;
}

const STATUS_DO_AGENDAMENTO: readonly StatusDoAgendamento[] = [
  'ok',
  'ja_inscrita',
  'concluida',
  'sessao_lotada',
  'sessao_indisponivel',
  'dados_invalidos',
  ...RECUSAS,
];

export function agendamentoPublico(bruto: unknown): RespostaDoAgendamento | null {
  const b = bruto as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || !STATUS_DO_AGENDAMENTO.includes(b.status as StatusDoAgendamento)) return null;
  const r: RespostaDoAgendamento = { status: b.status as StatusDoAgendamento };
  if (b.status === 'dados_invalidos' && typeof b.mensagem === 'string') r.mensagem = b.mensagem.slice(0, 200);
  const res = reserva(b.reserva);
  if (res) r.reserva = res;
  return r;
}

// ---------------------------------------------------------------------------
// Público
// ---------------------------------------------------------------------------

/** O link pode ter sido digitado à mão: sem espaços e em minúsculas (o banco guarda assim). */
export const normalizarCodigo = (c: unknown) => (typeof c === 'string' ? c.trim().toLowerCase().slice(0, 40) : '');

/** Página do convite. null = falha técnica (o visitante vê um aviso genérico). */
export async function abrirConvite(codigoDaUrl: string, origem: string): Promise<RespostaDoConvite | null> {
  const codigo = normalizarCodigo(codigoDaUrl);
  // Fora do formato nem vai ao banco (e não gasta tentativa).
  if (!ehCodigoDeConvite(codigo)) return { status: 'convite_invalido' };
  try {
    const { data, error } = await createAdminSupabase().rpc('agenda_kickoff_publico_convite', { p_codigo: codigo, p_origem: origem });
    if (error) return null;
    const pagina = paginaPublica(data);
    // Antecedência mínima: sessão que começa em menos de 15 minutos não é oferecida.
    if (pagina?.status === 'ok') pagina.sessoes = pagina.sessoes.filter((s) => dentroDaAntecedencia(s.starts_at));
    return pagina;
  } catch {
    return null;
  }
}

/** A sessão começa em menos tempo que a antecedência mínima? (false se não der para saber) */
async function semAntecedencia(sessaoId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminSupabase().from('meetings').select('scheduled_start_at').eq('id', sessaoId).maybeSingle();
    const inicio = (data as { scheduled_start_at?: unknown } | null)?.scheduled_start_at;
    return !error && typeof inicio === 'string' && !dentroDaAntecedencia(inicio);
  } catch {
    return false;
  }
}

/** Agendamento pelo link. null = falha técnica. */
export async function agendarPeloConvite(
  codigoDaUrl: string,
  origem: string,
  pedido: { sessaoId?: unknown; nome?: unknown; email?: unknown; telefone?: unknown },
): Promise<RespostaDoAgendamento | null> {
  const codigo = normalizarCodigo(codigoDaUrl);
  if (!ehCodigoDeConvite(codigo)) return { status: 'convite_invalido' };
  if (!ehUuid(pedido.sessaoId)) return { status: 'sessao_indisponivel' };
  const campo = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : null);
  // Antecedência mínima: recusa aqui a sessão que começa em menos de 15 minutos (a
  // página pode ter ficado aberta). Se não der para ler o horário, segue: o banco
  // continua recusando sessão que já começou.
  if (await semAntecedencia(pedido.sessaoId)) return { status: 'sessao_indisponivel' };
  try {
    const { data, error } = await createAdminSupabase().rpc('agenda_kickoff_publico_agendar', {
      p_codigo: codigo,
      p_meeting_id: pedido.sessaoId,
      p_nome: campo(pedido.nome),
      p_email: campo(pedido.email),
      p_telefone: campo(pedido.telefone),
      p_origem: origem,
    });
    if (error) return null;
    return agendamentoPublico(data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Gestão (equipe com a permissão de kickoff ou admin)
// ---------------------------------------------------------------------------

export interface ConviteGerado {
  codigo: string;
  criado_em: string;
  expira_em: string;
  reutilizado: boolean;
  /** Link no endereço oficial (KICKOFF_PUBLIC_BASE_URL). */
  link: string;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<Resultado<T>> {
  const { data, error } = await createAdminSupabase().rpc(fn, args);
  if (error) return { ok: false, ...erroDoBanco(error) };
  return { ok: true, dados: data as T };
}

function conferirEmpresa(tenantId: unknown): { ok: true; id: string } | ReturnType<typeof falhou> {
  if (!ehUuid(tenantId)) return falhou(400, 'Escolha a empresa');
  if (empresasInternas().includes(tenantId.toLowerCase())) return falhou(422, 'Empresa interna da Legacy não recebe convite.');
  return { ok: true, id: tenantId };
}

const validade = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 365 ? v : null);

/** Junta o link oficial ao convite que o banco devolveu. */
function comLink(r: Resultado<Omit<ConviteGerado, 'link'>>, base: string): Resultado<ConviteGerado> {
  if (!r.ok) return r;
  return { ok: true, dados: { ...r.dados, link: linkDoAgendamento(base, r.dados.codigo) } };
}

/**
 * Gerar e reemitir exigem o endereço oficial configurado ANTES de tocar no banco:
 * um link que não serve para o cliente não deve nem ser criado.
 */
export async function gerarConvite(usuarioId: string, tenantId: unknown, dias?: unknown, env = process.env) {
  const endereco = enderecoPublico(env);
  if (!endereco.ok) return falhou(409, endereco.motivo);
  const e = conferirEmpresa(tenantId);
  if (!e.ok) return e;
  const r = await rpc<Omit<ConviteGerado, 'link'>>('agenda_kickoff_convite_gerar', {
    p_tenant_id: e.id,
    p_validade_dias: validade(dias),
    p_usuario: usuarioId,
  });
  return comLink(r, endereco.base);
}

export async function reemitirConvite(usuarioId: string, tenantId: unknown, motivo: unknown, dias?: unknown, env = process.env) {
  const endereco = enderecoPublico(env);
  if (!endereco.ok) return falhou(409, endereco.motivo);
  const e = conferirEmpresa(tenantId);
  if (!e.ok) return e;
  const r = await rpc<Omit<ConviteGerado, 'link'>>('agenda_kickoff_convite_reemitir', {
    p_tenant_id: e.id,
    p_validade_dias: validade(dias),
    p_motivo: typeof motivo === 'string' ? motivo.slice(0, 500) : null,
    p_usuario: usuarioId,
  });
  return comLink(r, endereco.base);
}

export async function revogarConvite(usuarioId: string, tenantId: unknown, motivo: unknown) {
  if (!ehUuid(tenantId)) return falhou(400, 'Escolha a empresa');
  return rpc<{ revogados: number }>('agenda_kickoff_convite_revogar', {
    p_tenant_id: tenantId,
    p_motivo: typeof motivo === 'string' ? motivo.slice(0, 500) : null,
    p_usuario: usuarioId,
  });
}

/** A estrutura dos convites (migration 005) existe no banco? */
export async function estruturaDosConvites(): Promise<'ok' | 'pendente'> {
  try {
    const { error } = await createAdminSupabase().from('agenda_kickoff_convites').select('id').limit(1);
    return error ? 'pendente' : 'ok';
  } catch {
    return 'pendente';
  }
}

export interface ConviteDaEmpresa {
  codigo: string;
  criadoEm: string;
  expiraEm: string;
  expirado: boolean;
  empresa: { id: string; nome: string };
  /** Situação do kickoff da empresa (reserva vinculada). */
  reserva: { status: string; sessaoId: string; inicio: string | null } | null;
  /** Link no endereço oficial; null se KICKOFF_PUBLIC_BASE_URL não estiver configurada. */
  link: string | null;
}

/** Convites em vigor (não revogados), com a reserva da empresa. null = estrutura pendente. */
export async function listarConvites(): Promise<ConviteDaEmpresa[] | null> {
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from('agenda_kickoff_convites')
      .select('codigo, criado_em, expira_em, tenant_id, client_tenants(name)')
      .is('revogado_em', null)
      .order('criado_em', { ascending: false })
      .limit(500);
    if (error) return null;
    type Linha = {
      codigo: string;
      criado_em: string;
      expira_em: string;
      tenant_id: string;
      client_tenants: { name: string | null } | Array<{ name: string | null }> | null;
    };
    const linhas = (data ?? []) as unknown as Linha[];
    const tenants = linhas.map((l) => l.tenant_id);
    const reservas = new Map<string, { status: string; sessaoId: string; inicio: string | null }>();
    if (tenants.length) {
      const { data: rs } = await admin
        .from('agenda_kickoff_reservas')
        .select('tenant_id, status, meeting_id, meetings(scheduled_start_at)')
        .in('tenant_id', tenants)
        .in('status', ['ativa', 'concluida'])
        .limit(1000);
      for (const r of (rs ?? []) as unknown as Array<{
        tenant_id: string;
        status: string;
        meeting_id: string;
        meetings: { scheduled_start_at: string } | Array<{ scheduled_start_at: string }> | null;
      }>) {
        const m = Array.isArray(r.meetings) ? r.meetings[0] : r.meetings;
        reservas.set(r.tenant_id, { status: r.status, sessaoId: r.meeting_id, inicio: m?.scheduled_start_at ?? null });
      }
    }
    const agora = Date.now();
    return linhas.map((l) => {
      const t = Array.isArray(l.client_tenants) ? l.client_tenants[0] : l.client_tenants;
      return {
        codigo: l.codigo,
        criadoEm: l.criado_em,
        expiraEm: l.expira_em,
        expirado: Date.parse(l.expira_em) <= agora,
        link: linkOficial(l.codigo),
        empresa: { id: l.tenant_id, nome: t?.name?.trim() || 'Empresa' },
        reserva: reservas.get(l.tenant_id) ?? null,
      };
    });
  } catch {
    return null;
  }
}
