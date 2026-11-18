/**
 * Função no Comercial (regras puras, sem banco): o SDR agenda a reunião para
 * um Closer, e o Closer conduz. Fica em meet_user_profile.funcao_comercial.
 *
 * - SDR: ao criar reunião do Comercial escolhe o Closer responsável. O Closer
 *   vira o dono da reunião (agenda, números, conflito) e o SDR entra como
 *   anfitrião adicional. A agenda do SDR não trava: ele só agenda.
 * - Closer: a agenda dele é conferida, contando também as reuniões em que
 *   ele é anfitrião adicional (agendamentos antigos dos SDRs).
 */

export const FUNCOES_COMERCIAIS = ['sdr', 'closer'] as const;
export type FuncaoComercial = (typeof FUNCOES_COMERCIAIS)[number];

export const ROTULO_FUNCAO: Record<FuncaoComercial, string> = { sdr: 'SDR', closer: 'Closer' };

/** Lê a função do perfil (coluna pode não existir antes da migration). */
export function lerFuncaoComercial(perfil: unknown): FuncaoComercial | null {
  const v = (perfil as { funcao_comercial?: unknown } | null | undefined)?.funcao_comercial;
  return FUNCOES_COMERCIAIS.includes(v as FuncaoComercial) ? (v as FuncaoComercial) : null;
}

/** Só quem tem acesso ao Comercial (setor comercial ou ambos) tem função. */
export function funcaoParaSetor(funcao: unknown, setor: string | null | undefined): FuncaoComercial | null {
  if (setor !== 'comercial' && setor !== 'ambos') return null;
  return FUNCOES_COMERCIAIS.includes(funcao as FuncaoComercial) ? (funcao as FuncaoComercial) : null;
}

/** Reunião do Comercial criada por um SDR: precisa do Closer responsável. */
export function agendaParaCloser(
  u: { funcaoComercial?: FuncaoComercial | null } | null | undefined,
  setor: string | null | undefined,
  kickoff = false,
): boolean {
  return !kickoff && setor === 'comercial' && u?.funcaoComercial === 'sdr';
}
