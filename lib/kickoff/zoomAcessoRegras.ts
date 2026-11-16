/**
 * Acesso Zoom do kickoff (Zoom E2): regras puras e textos usados pelas TELAS (painel
 * da equipe e página da empresa), pelo servidor e pelos testes. Não importa o cliente
 * do Zoom: nada daqui leva credencial, token ou link individual para o navegador.
 */

/** Estado do acesso de cada reserva no painel (agenda_kickoff_zoom_acessos). */
export type EstadoDoAcesso = 'pronto' | 'preparando' | 'pendente' | 'sem_sala' | 'conflito' | 'erro' | 'inativo';

export const ESTADOS_DO_ACESSO: readonly EstadoDoAcesso[] = ['pronto', 'preparando', 'pendente', 'sem_sala', 'conflito', 'erro', 'inativo'];

export const ROTULO_DO_ACESSO: Record<EstadoDoAcesso, string> = {
  pronto: 'Acesso Zoom pronto',
  preparando: 'Preparando o acesso Zoom',
  pendente: 'Acesso Zoom ainda não gerado',
  sem_sala: 'Sem sala Zoom ativa',
  conflito: 'Conflito no Zoom: revisar o e-mail',
  erro: 'Falha ao gerar o acesso Zoom',
  inativo: 'Sem acesso Zoom',
};

/** O que o painel mostra de cada reserva. Nunca o link individual do Zoom. */
export interface AcessoDaReserva {
  estado: EstadoDoAcesso;
  /** Motivo, para a equipe (erro e conflito). */
  erro: string | null;
  /** Nome que o Zoom guardou para a inscrição pronta. */
  nomeNoZoom: string | null;
  /** O nome do participante mudou depois da inscrição (o Zoom não altera o nome). */
  nomeDifere: boolean;
  /** Havia acesso pronto em uma sala anterior: precisa ser gerado de novo na sala atual. */
  salaAnterior: boolean;
  salaComProblemas: boolean;
  atualizadoEm: string | null;
  /** Endereço da Legacy que a equipe copia (/impulsao/reuniao/<código>); null sem convite ou sem endereço oficial. */
  endereco: string | null;
}

/** A equipe pode pedir (de novo) o acesso desta reserva? */
export function podeGerarAcesso(a: Pick<AcessoDaReserva, 'estado' | 'endereco'>): boolean {
  if (a.estado === 'pendente' || a.estado === 'erro' || a.estado === 'conflito') return true;
  // Acesso pronto, mas a empresa ainda não tem convite: gerar cria o endereço da Legacy.
  return a.estado === 'pronto' && !a.endereco;
}

/**
 * O que a página da empresa mostra. Erro, conflito e problema de sala nunca são
 * detalhados para o cliente: "preparando" (vale tentar de novo) ou "indisponivel"
 * (o time da Legacy resolve e avisa).
 */
export type EstadoPublicoDoAcesso = 'pronto' | 'preparando' | 'indisponivel';

export function estadoPublico(estado: string, salaComProblemas = false): EstadoPublicoDoAcesso {
  switch (estado) {
    case 'pronto':
      return 'pronto';
    case 'preparando':
    case 'erro':
      return 'preparando';
    case 'pendente':
      return salaComProblemas ? 'indisponivel' : 'preparando';
    default:
      return 'indisponivel';
  }
}

/** Acesso à reunião na página da empresa. Sem link do Zoom: só o endereço da Legacy. */
export interface AcessoPublico {
  estado: EstadoPublicoDoAcesso;
  /** /impulsao/reuniao/<código> no endereço oficial; null = a página monta com o próprio endereço. */
  endereco: string | null;
  /** Quando o endereço começa e para de encaminhar ao Zoom (sessão da reserva). */
  abreEm: string;
  fechaEm: string;
}

// ---------------------------------------------------------------------------
// Quando o endereço da reunião encaminha para o Zoom
// ---------------------------------------------------------------------------

/** O endereço /impulsao/reuniao/<código> abre 30 minutos antes do início da sessão da reserva... */
export const ACESSO_ABRE_ANTES_MIN = 30;
/** ...e continua valendo até 30 minutos depois do horário de término (atraso, queda de conexão). */
export const ACESSO_FECHA_DEPOIS_MIN = 30;

export type JanelaDoAcesso = 'antes' | 'aberta' | 'encerrada';

export function limitesDoAcesso(inicio: string, fim: string): { abreEm: string; fechaEm: string } | null {
  const i = Date.parse(inicio);
  const f = Date.parse(fim);
  if (!Number.isFinite(i) || !Number.isFinite(f)) return null;
  return {
    abreEm: new Date(i - ACESSO_ABRE_ANTES_MIN * 60_000).toISOString(),
    fechaEm: new Date(Math.max(i, f) + ACESSO_FECHA_DEPOIS_MIN * 60_000).toISOString(),
  };
}

/** A janela vale para a SESSÃO DA RESERVA: fora dela, o endereço não encaminha ao Zoom. */
export function janelaDoAcesso(limites: { abreEm: string; fechaEm: string } | null, agora: number = Date.now()): JanelaDoAcesso {
  if (!limites) return 'encerrada';
  if (agora < Date.parse(limites.abreEm)) return 'antes';
  return agora <= Date.parse(limites.fechaEm) ? 'aberta' : 'encerrada';
}
