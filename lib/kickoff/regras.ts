/**
 * Kickoff Impulsão: regras puras (sem servidor, sem banco), usadas pelo
 * servidor, pela tela e pelos testes. Ver docs/kickoff/README.md.
 */
import { PERMISSAO_VER_TODAS_GRAVACOES } from '@/lib/acessoGravacoes';

/** Marcador do tipo de evento na agenda (agenda_kickoff_sessoes.tipo). */
export const KICKOFF_TIPO = 'kickoff_impulsao' as const;

/** Permissão funcional que libera a gestão dos kickoffs (meet_user_profile.capacidades). */
export const PERMISSAO_KICKOFF = 'kickoff_impulsao.manage' as const;

/** Permissões que o perfil aceita (mesma lista do check do banco). */
export const CAPACIDADES_CONHECIDAS: readonly string[] = [PERMISSAO_KICKOFF, PERMISSAO_VER_TODAS_GRAVACOES];

/** Configuração básica do tipo de evento (M1: fixa no código). */
export const CAPACIDADE_PADRAO = 5;
export const CAPACIDADE_MIN = 1;
export const CAPACIDADE_MAX = 50;
export const DURACAO_PADRAO_MIN = 60;

/** Lê as capacidades do perfil (coluna pode não existir antes da migration). */
export function lerCapacidades(perfil: unknown): string[] {
  const v = (perfil as { capacidades?: unknown } | null | undefined)?.capacidades;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && CAPACIDADES_CONHECIDAS.includes(x)) : [];
}

/** Liga ou desliga uma capacidade, sem mexer nas outras. */
export function alternarCapacidade(atuais: string[], capacidade: string, ligar: boolean): string[] {
  const sem = atuais.filter((c) => c !== capacidade && CAPACIDADES_CONHECIDAS.includes(c));
  return ligar ? [...sem, capacidade] : sem;
}

/** Capacidade de 1 a 50; vazio = padrão; inválido = null. */
export function capacidadeValida(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return CAPACIDADE_PADRAO;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= CAPACIDADE_MIN && n <= CAPACIDADE_MAX ? n : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Empresa organizadora interna das sessões (meetings.tenant_id é obrigatório).
 * Vem do ambiente, como a sentinela do Comercial. null = não configurada:
 * a criação de sessões de kickoff fica recusada.
 */
export function organizadorDoKickoff(env: Record<string, string | undefined> = process.env): string | null {
  const id = env.MEET_KICKOFF_TENANT_ID?.trim();
  return id && UUID.test(id) ? id.toLowerCase() : null;
}
