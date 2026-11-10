/**
 * Reuniões atingidas por uma edição/cancelamento conforme o escopo
 * ("somente este", "este e os seguintes", "todos"), mais a checagem de
 * permissão. Só reuniões agendadas (status scheduled) mudam.
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { CurrentUser } from '@/lib/auth';
import type { Escopo } from './tipos';

export type LinhaAlvo = {
  id: string;
  host_id: string;
  title: string | null;
  status: string;
  scheduled_start_at: string;
  scheduled_end_at: string | null;
  recurrence_parent_id: string | null;
};

const COLS = 'id, host_id, title, status, scheduled_start_at, scheduled_end_at, recurrence_parent_id';

export type Alvos =
  | { ok: true; base: LinhaAlvo; alvos: LinhaAlvo[] }
  | { ok: false; status: number; message: string };

export async function resolverAlvos(user: Pick<CurrentUser, 'id' | 'isAdmin'>, id: string, escopo: Escopo): Promise<Alvos> {
  const admin = createAdminSupabase();
  const { data: base } = await admin.from('meetings').select(COLS).eq('id', id).maybeSingle();
  if (!base) return { ok: false, status: 404, message: 'Reunião não encontrada' };
  const b = base as LinhaAlvo;
  if (!user.isAdmin && b.host_id !== user.id) return { ok: false, status: 403, message: 'Só o anfitrião ou um admin pode alterar' };
  if (b.status !== 'scheduled') return { ok: false, status: 400, message: 'Só reuniões agendadas podem ser alteradas' };

  if (escopo === 'esta' || !b.recurrence_parent_id) return { ok: true, base: b, alvos: [b] };
  let q = admin.from('meetings').select(COLS).eq('recurrence_parent_id', b.recurrence_parent_id).eq('status', 'scheduled');
  if (escopo === 'seguintes') q = q.gte('scheduled_start_at', b.scheduled_start_at);
  const { data, error } = await q.order('scheduled_start_at').limit(500);
  if (error) return { ok: false, status: 500, message: error.message };
  const alvos = (data ?? []) as LinhaAlvo[];
  if (!alvos.some((a) => a.id === b.id)) alvos.unshift(b);
  return { ok: true, base: b, alvos };
}

export const fimDe = (l: LinhaAlvo) => {
  const ini = new Date(l.scheduled_start_at).getTime();
  const fim = l.scheduled_end_at ? new Date(l.scheduled_end_at).getTime() : ini + 3_600_000;
  return fim > ini ? fim : ini + 3_600_000;
};
