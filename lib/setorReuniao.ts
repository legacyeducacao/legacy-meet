/**
 * Setor de uma reunião (meet_meeting_sector.sector).
 * - executoria: com cliente da carteira; vai para ExecScore, NPS e resumo.
 * - comercial: empresa interna; sem Google Agenda (as tarefas ficam no CRM).
 * - avulsa: sem cliente (interna, parceiro, entrevista). Empresa interna,
 *   fora do ExecScore, do NPS e do painel; gravação só dos anfitriões e admins.
 */
export const SETORES_REUNIAO = ['executoria', 'comercial', 'avulsa'] as const;
export type SetorReuniao = (typeof SETORES_REUNIAO)[number];

export const ROTULO_SETOR: Record<SetorReuniao, string> = {
  executoria: 'Executoria',
  comercial: 'Comercial',
  avulsa: 'Avulsa',
};

/** Setor vindo do corpo da requisição (o que não for conhecido vira Executoria, como antes). */
export function lerSetorReuniao(v: unknown): SetorReuniao {
  return SETORES_REUNIAO.includes(v as SetorReuniao) ? (v as SetorReuniao) : 'executoria';
}
