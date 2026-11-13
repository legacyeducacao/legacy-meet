/**
 * Em nome de qual empresa (client_tenants) o usuário pode criar uma reunião.
 * Usado por /api/meetings/local e /api/meetings/schedule.
 *
 * O login é o mesmo do Legacy Plan: clientes do Plan também têm sessão aqui.
 * Por isso a empresa nunca é aceita só porque veio no corpo da requisição.
 *
 * Regras (as mesmas que a tela e o resto do app já usam):
 * - Só a equipe da Legacy cria reunião (CurrentUser.isStaff).
 * - Comercial: a empresa é sempre a sentinela MEET_COMMERCIAL_TENANT_ID (o corpo
 *   é ignorado) e o usuário precisa ter acesso ao Comercial (canSeeComercial).
 * - Executoria: o cliente precisa existir e ser da carteira do usuário
 *   (client_tenants.executor_id = usuário), como em /api/clients e em
 *   POST /api/agenda/jornadas. Admin do Meet cria para qualquer cliente.
 */
import { canSeeComercial, type CurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export type AcessoEmpresa =
  | { ok: true; tenantId: string }
  | { ok: false; status: 400 | 403 | 404 | 500; message: string };

/** Cliente pelo id (null = não existe). Lança se o banco falhar. */
export type BuscarCliente = (tenantId: string) => Promise<{ id: string; executorId: string | null } | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const buscarCliente: BuscarCliente = async (tenantId) => {
  const { data, error } = await createAdminSupabase()
    .from('client_tenants')
    .select('id, executor_id')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: data.id as string, executorId: (data.executor_id as string | null) ?? null };
};

export async function autorizarEmpresaDaReuniao(
  user: CurrentUser,
  sector: 'comercial' | 'executoria',
  tenantIdDoCorpo: unknown,
  buscar: BuscarCliente = buscarCliente,
): Promise<AcessoEmpresa> {
  if (!user.isStaff) return { ok: false, status: 403, message: 'Sem permissão para criar reuniões' };

  if (sector === 'comercial') {
    if (!canSeeComercial(user)) return { ok: false, status: 403, message: 'Sem acesso a reuniões do Comercial' };
    const sentinela = process.env.MEET_COMMERCIAL_TENANT_ID;
    if (!sentinela) return { ok: false, status: 400, message: 'Cliente (tenant) obrigatório para Executoria' };
    return { ok: true, tenantId: sentinela };
  }

  const pedido = typeof tenantIdDoCorpo === 'string' ? tenantIdDoCorpo.trim() : '';
  if (!pedido) return { ok: false, status: 400, message: 'Cliente (tenant) obrigatório para Executoria' };
  if (!UUID.test(pedido)) return { ok: false, status: 404, message: 'Cliente não encontrado' };

  let cliente: Awaited<ReturnType<BuscarCliente>>;
  try {
    cliente = await buscar(pedido);
  } catch {
    return { ok: false, status: 500, message: 'Falha ao verificar o cliente' };
  }
  if (!cliente) return { ok: false, status: 404, message: 'Cliente não encontrado' };
  if (!user.isAdmin && cliente.executorId !== user.id) {
    return { ok: false, status: 403, message: 'Só clientes da sua carteira' };
  }
  // O id que segue é o do banco, não o do corpo.
  return { ok: true, tenantId: cliente.id };
}
