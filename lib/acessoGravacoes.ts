/**
 * Quem vê (lista e abre) uma gravação. Regra pedida pelo usuário em 24/11/2026:
 * - admin, ou quem tem a permissão "Ver todas as gravações": todas;
 * - quem é anfitrião (dono ou adicional) da reunião: a dela, sempre;
 * - setor Comercial: todas do Comercial;
 * - setor Executoria: todas da Executoria;
 * - Acesso geral (ambos): Comercial e Executoria;
 * - reunião avulsa (ou sem setor): só anfitriões, admins e a permissão.
 */
export const PERMISSAO_VER_TODAS_GRAVACOES = 'gravacoes.ver_todas' as const;

export type QuemVe = {
  id: string;
  isAdmin: boolean;
  sector?: string | null;
  capacidades?: string[];
};

export type GravacaoDono = {
  hostId: string | null;
  coHostIds: string[];
  sector: string | null;
};

export function veTodasAsGravacoes(u: QuemVe): boolean {
  return u.isAdmin || (u.capacidades ?? []).includes(PERMISSAO_VER_TODAS_GRAVACOES);
}

export function podeVerGravacao(u: QuemVe, g: GravacaoDono): boolean {
  if (veTodasAsGravacoes(u)) return true;
  if ((g.hostId !== null && g.hostId === u.id) || g.coHostIds.includes(u.id)) return true;
  if (g.sector === 'comercial') return u.sector === 'comercial' || u.sector === 'ambos';
  if (g.sector === 'executoria') return u.sector === 'executoria' || u.sector === 'ambos';
  return false;
}
