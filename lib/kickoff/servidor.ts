/**
 * Kickoff Impulsão no servidor (service_role). Toda leitura de
 * agenda_kickoff_sessoes passa por aqui e tolera a tabela ainda não existir
 * (migration integracoes/kickoff/001 não aplicada): nesse caso nada é
 * kickoff e a criação de sessões é recusada com "estrutura pendente".
 */
import { podeGerenciarKickoff, type CurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { buscarCliente } from '@/lib/meetingTenantAccess';
import { capacidadeValida, organizadorDoKickoff } from './regras';
import { ocupacaoDasSessoes } from './reservas';
import type { InfoKickoff } from './evento';

const TABELA = 'agenda_kickoff_sessoes';

/** A tabela do kickoff existe no banco? */
export async function estruturaDoKickoff(): Promise<'ok' | 'pendente'> {
  const { error } = await createAdminSupabase().from(TABELA).select('meeting_id').limit(1);
  return error ? 'pendente' : 'ok';
}

/** Quais destas reuniões são sessões de kickoff (e a configuração de cada uma). */
export async function sessoesDeKickoff(ids: string[]): Promise<Map<string, InfoKickoff>> {
  const mapa = new Map<string, InfoKickoff>();
  const admin = createAdminSupabase();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from(TABELA)
      .select('meeting_id, capacidade, aceita_reservas')
      .in('meeting_id', ids.slice(i, i + 200));
    if (error) return mapa; // estrutura pendente: nada é kickoff
    for (const r of (data ?? []) as Array<{ meeting_id: string; capacidade: number; aceita_reservas: boolean }>) {
      mapa.set(r.meeting_id, { capacidade: r.capacidade, aceitaReservas: r.aceita_reservas, ocupadas: 0 });
    }
  }
  // Empresas inscritas (M2). Sem a migration das reservas, fica 0.
  if (mapa.size) {
    const ocupacao = await ocupacaoDasSessoes([...mapa.keys()]);
    for (const [id, n] of ocupacao) {
      const info = mapa.get(id);
      if (info) info.ocupadas = n;
    }
  }
  return mapa;
}

/** Resposta das rotas antigas de reunião para sessões de kickoff. */
export const SO_PELA_AGENDA = 'Sessão de kickoff do Impulsão: altere pela agenda ou pela seção Kickoffs Impulsão';

export async function ehSessaoDeKickoff(meetingId: string): Promise<boolean> {
  return (await sessoesDeKickoff([meetingId])).has(meetingId);
}

/** Marca as reuniões recém-criadas como sessões de kickoff. */
export async function registrarSessoesKickoff(
  meetingIds: string[],
  capacidade: number,
  criadoPor: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await createAdminSupabase()
    .from(TABELA)
    .insert(meetingIds.map((meeting_id) => ({ meeting_id, capacidade, criado_por: criadoPor })));
  return error ? { ok: false, message: error.message } : { ok: true };
}

export type PreparoKickoff =
  | { ok: true; tenantId: string; capacidade: number }
  | { ok: false; status: 400 | 403 | 409 | 500 | 503; message: string };

/**
 * Antes de criar uma sessão de kickoff: permissão, capacidade, empresa
 * organizadora configurada e existente, e estrutura instalada. A empresa da
 * sessão é sempre a organizadora; nunca vem do pedido.
 */
export async function prepararKickoff(
  user: Pick<CurrentUser, 'isStaff' | 'isAdmin' | 'capacidades'>,
  capacidadePedida: unknown,
): Promise<PreparoKickoff> {
  if (!podeGerenciarKickoff(user)) {
    return { ok: false, status: 403, message: 'Só quem gerencia os kickoffs do Impulsão cria sessões de kickoff' };
  }
  const capacidade = capacidadeValida(capacidadePedida);
  if (capacidade === null) return { ok: false, status: 400, message: 'A capacidade deve ser de 1 a 50 empresas' };
  const organizador = organizadorDoKickoff();
  if (!organizador) {
    return { ok: false, status: 409, message: 'A empresa organizadora dos kickoffs não está configurada (MEET_KICKOFF_TENANT_ID)' };
  }
  if ((await estruturaDoKickoff()) !== 'ok') {
    return { ok: false, status: 503, message: 'A estrutura do kickoff ainda não foi instalada no banco (migration pendente)' };
  }
  let empresa: Awaited<ReturnType<typeof buscarCliente>>;
  try {
    empresa = await buscarCliente(organizador);
  } catch {
    return { ok: false, status: 500, message: 'Falha ao verificar a empresa organizadora' };
  }
  if (!empresa) return { ok: false, status: 409, message: 'A empresa organizadora configurada não existe' };
  return { ok: true, tenantId: empresa.id, capacidade };
}

export interface SessaoKickoffLinha {
  id: string;
  titulo: string;
  inicio: string;
  fim: string;
  status: string;
  anfitriao: string | null;
  serieId: string | null;
  capacidade: number;
  aceitaReservas: boolean;
}

/** Sessões de kickoff do período (tela Kickoffs Impulsão). null = estrutura pendente. */
export async function listarSessoesKickoff(de: Date, ate: Date): Promise<SessaoKickoffLinha[] | null> {
  const { data, error } = await createAdminSupabase()
    .from(TABELA)
    .select(
      'capacidade, aceita_reservas, meetings!inner(id, title, status, scheduled_start_at, scheduled_end_at, recurrence_parent_id, users:host_id(name))',
    )
    .gte('meetings.scheduled_start_at', de.toISOString())
    .lt('meetings.scheduled_start_at', ate.toISOString())
    .limit(500);
  if (error) return null;
  type Linha = {
    capacidade: number;
    aceita_reservas: boolean;
    meetings: {
      id: string;
      title: string | null;
      status: string;
      scheduled_start_at: string;
      scheduled_end_at: string | null;
      recurrence_parent_id: string | null;
      users: { name: string | null } | Array<{ name: string | null }> | null;
    } | null;
  };
  return ((data ?? []) as unknown as Linha[])
    .filter((l) => l.meetings)
    .map((l) => {
      const m = l.meetings!;
      const u = Array.isArray(m.users) ? m.users[0] : m.users;
      return {
        id: m.id,
        titulo: m.title?.trim() || 'Kickoff Impulsão',
        inicio: m.scheduled_start_at,
        fim: m.scheduled_end_at ?? m.scheduled_start_at,
        status: m.status,
        anfitriao: u?.name ?? null,
        serieId: m.recurrence_parent_id,
        capacidade: l.capacidade,
        aceitaReservas: l.aceita_reservas,
      };
    })
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
}
