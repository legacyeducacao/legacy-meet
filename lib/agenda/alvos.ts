/**
 * Reuniões atingidas por uma edição/cancelamento conforme o escopo
 * ("somente este", "este e os seguintes", "todos"), mais a checagem de
 * permissão. Só reuniões agendadas (status scheduled) mudam.
 *
 * Permissão (o login é o mesmo do Legacy Plan, então ter sessão não basta):
 * - só a equipe do Meet (isStaff);
 * - só reuniões do Meet (com meet_meeting_sector), não as do Planner do Plan,
 *   que dividem a tabela meetings;
 * - a operação: anfitrião ou admin;
 * - a empresa da reunião: a mesma regra da criação (lib/meetingTenantAccess.ts);
 * - sessão de kickoff do Impulsão: no lugar das duas regras acima, a permissão
 *   'kickoff_impulsao.manage' (ou admin);
 * - a série só se estende a reuniões do mesmo anfitrião e da mesma empresa.
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { podeGerenciarKickoff, type CurrentUser } from '@/lib/auth';
import { autorizarEmpresaDaReuniao } from '@/lib/meetingTenantAccess';
import { ehSessaoDeKickoff } from '@/lib/kickoff/servidor';
import type { Escopo } from './tipos';

export type LinhaAlvo = {
  id: string;
  host_id: string;
  title: string | null;
  status: string;
  scheduled_start_at: string;
  scheduled_end_at: string | null;
  recurrence_parent_id: string | null;
  tenant_id: string | null;
  meet_meeting_sector: { sector: string } | { sector: string }[] | null;
};

// !inner: só reuniões criadas pelo Meet.
const COLS = 'id, host_id, title, status, scheduled_start_at, scheduled_end_at, recurrence_parent_id, tenant_id, meet_meeting_sector!inner(sector)';

export type Alvos =
  /** kickoff: sessão de kickoff do Impulsão (as mudanças passam pelas regras das reservas). */
  | { ok: true; base: LinhaAlvo; alvos: LinhaAlvo[]; kickoff: boolean }
  | { ok: false; status: number; message: string };

const setorDe = (l: LinhaAlvo): 'comercial' | 'executoria' => {
  const s = Array.isArray(l.meet_meeting_sector) ? l.meet_meeting_sector[0] : l.meet_meeting_sector;
  return s?.sector === 'comercial' ? 'comercial' : 'executoria';
};

export async function resolverAlvos(user: CurrentUser, id: string, escopo: Escopo): Promise<Alvos> {
  if (!user.isStaff) return { ok: false, status: 403, message: 'Sem permissão para alterar reuniões' };
  const admin = createAdminSupabase();
  const { data: base } = await admin.from('meetings').select(COLS).eq('id', id).maybeSingle();
  if (!base) return { ok: false, status: 404, message: 'Reunião não encontrada' };
  const b = base as unknown as LinhaAlvo;
  const kickoff = await ehSessaoDeKickoff(b.id);
  if (kickoff) {
    // Sessão de kickoff do Impulsão: é do processo de kickoff (empresa
    // organizadora interna), não da carteira do anfitrião. Vale a permissão.
    if (!podeGerenciarKickoff(user)) {
      return { ok: false, status: 403, message: 'Só quem gerencia os kickoffs do Impulsão pode alterar esta sessão' };
    }
  } else {
    if (!user.isAdmin && b.host_id !== user.id) return { ok: false, status: 403, message: 'Só o anfitrião ou um admin pode alterar' };
    const empresa = await autorizarEmpresaDaReuniao(user, setorDe(b), b.tenant_id);
    if (!empresa.ok) return { ok: false, status: empresa.status, message: empresa.message };
  }
  if (b.status !== 'scheduled') return { ok: false, status: 400, message: 'Só reuniões agendadas podem ser alteradas' };

  if (escopo === 'esta' || !b.recurrence_parent_id) return { ok: true, base: b, alvos: [b], kickoff };
  let q = admin.from('meetings').select(COLS).eq('recurrence_parent_id', b.recurrence_parent_id).eq('status', 'scheduled');
  // A série não pode atingir reunião de outro anfitrião ou de outra empresa.
  q = b.host_id ? q.eq('host_id', b.host_id) : q.is('host_id', null);
  q = b.tenant_id ? q.eq('tenant_id', b.tenant_id) : q.is('tenant_id', null);
  if (escopo === 'seguintes') q = q.gte('scheduled_start_at', b.scheduled_start_at);
  const { data, error } = await q.order('scheduled_start_at').limit(500);
  if (error) return { ok: false, status: 500, message: error.message };
  const alvos = (data ?? []) as unknown as LinhaAlvo[];
  if (!alvos.some((a) => a.id === b.id)) alvos.unshift(b);
  return { ok: true, base: b, alvos, kickoff };
}

export const fimDe = (l: LinhaAlvo) => {
  const ini = new Date(l.scheduled_start_at).getTime();
  const fim = l.scheduled_end_at ? new Date(l.scheduled_end_at).getTime() : ini + 3_600_000;
  return fim > ini ? fim : ini + 3_600_000;
};
