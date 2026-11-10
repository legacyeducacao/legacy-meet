/**
 * Tipos compartilhados entre a tela da agenda nova e as rotas /api/agenda.
 * Sem dependência de servidor: pode ir para o navegador.
 */

export type Calendario = 'impulsao' | 'legado' | 'comercial' | 'outros' | 'bloqueios' | 'feriados';

export const CALENDARIOS: Array<{ id: Calendario; nome: string; cor: string }> = [
  { id: 'impulsao', nome: 'Impulsão', cor: '#7c3aed' },
  { id: 'legado', nome: 'Legado', cor: '#2563eb' },
  { id: 'comercial', nome: 'Comercial', cor: '#059669' },
  { id: 'outros', nome: 'Outras reuniões', cor: '#0891b2' },
  { id: 'bloqueios', nome: 'Pessoal / bloqueios', cor: '#64748b' },
  { id: 'feriados', nome: 'Feriados', cor: '#dc2626' },
];

export type StatusReuniao = 'scheduled' | 'live' | 'ended' | 'canceled' | 'no_show';

export interface EventoDTO {
  id: string;
  tipo: 'reuniao' | 'bloqueio';
  titulo: string;
  inicio: string; // ISO
  fim: string; // ISO
  diaInteiro?: boolean;
  calendario: Calendario;
  status?: StatusReuniao;
  roomName?: string;
  executorId: string;
  executorNome?: string | null;
  cliente?: string | null;
  tenantId?: string | null;
  setor?: 'executoria' | 'comercial' | null;
  /** recurrence_parent_id: eventos da mesma série. */
  serieId?: string | null;
  rotulo?: string | null;
  gravar?: boolean;
  transcrever?: boolean;
  onboarding?: boolean;
  /** Pode mover, editar e excluir. */
  podeEditar: boolean;
}

export interface FeriadoDTO {
  data: string; // YYYY-MM-DD
  nome: string;
  escopo: string;
  facultativo?: boolean;
}

export type Escopo = 'esta' | 'seguintes' | 'todas';
export type Origem = 'cliente' | 'executor' | 'legacy';

export interface ConflitoDTO {
  ref: string;
  inicio: string;
  tipo: string;
  nivel: 'bloqueante' | 'aviso';
  detalhe: string;
  acaoSugerida: string;
  sugestao?: string;
}

/** Resposta 409 das rotas de salvar quando há conflito sem justificativa. */
export interface RespostaConflito {
  conflitos: ConflitoDTO[];
  /** Quem está salvando pode passar por cima dos bloqueantes (admin). */
  podeSobreporBloqueante: boolean;
}

export const NOME_CONFLITO: Record<string, string> = {
  sobreposicao: 'Sobreposição',
  bloqueio: 'Horário bloqueado',
  feriado: 'Feriado',
  fora_expediente: 'Fora do expediente',
  buffer: 'Intervalo curto',
  preparo: 'Pouco tempo de preparo',
  limite_reunioes_dia: 'Limite de reuniões no dia',
  limite_horas_dia: 'Limite de horas no dia',
  limite_horas_semana: 'Limite de horas na semana',
};
