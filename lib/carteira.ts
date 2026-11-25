/**
 * Carteira de clientes de um executor no Meet. O cliente é da carteira de quem
 * é o executor principal (client_tenants.executor_id) ou o executor financeiro
 * (client_tenants.executor_financeiro_id, função criada no Legacy Plan em
 * nov/2026). Os dois criam reuniões, veem o cliente na lista e as jornadas dele.
 */
export interface ClienteDaCarteira {
  executorId: string | null;
  executorFinanceiroId?: string | null;
}

export function ehDaCarteira(c: ClienteDaCarteira, userId: string): boolean {
  return c.executorId === userId || (!!c.executorFinanceiroId && c.executorFinanceiroId === userId);
}

/** Filtro do PostgREST (.or) para os clientes da carteira de um usuário. */
export function filtroCarteira(userId: string): string {
  return `executor_id.eq.${userId},executor_financeiro_id.eq.${userId}`;
}
