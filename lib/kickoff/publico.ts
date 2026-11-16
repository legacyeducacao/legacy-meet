/**
 * Agendamento público do kickoff do Impulsão: /impulsao/agendar/<código>.
 * Regras puras e textos, usados pela página (navegador), pelas rotas públicas
 * (servidor) e pelos testes. Adaptado do Legacy CS (src/lib/kickoffs-publico.ts).
 *
 * O código de 12 caracteres é a única coisa no link: nada de id, CNPJ ou nome da
 * empresa. Quem tem o link vê só a empresa do convite; o banco decide tudo (vagas,
 * uma reserva por empresa, limite de tentativas).
 *
 * Código do convite x link do Zoom: o código identifica a EMPRESA (agendar e
 * recuperar a reserva). O link individual do Zoom é outra coisa: fica só no
 * servidor, e /impulsao/reuniao/<mesmo código> acha a reserva pelo convite e
 * encaminha a ele (Zoom E2). A página nunca recebe o link do Zoom.
 */
import type { AcessoPublico } from './zoomAcessoRegras';

/** Alfabeto sem 0/o, 1/l/i, 12 caracteres (mesmo check do banco). */
const CODIGO_DO_CONVITE = /^[a-hj-km-np-z2-9]{12}$/;

/** Código no formato certo (minúsculas, sem espaços). Fora do formato nem vai ao banco. */
export function ehCodigoDeConvite(trecho: unknown): trecho is string {
  return typeof trecho === 'string' && CODIGO_DO_CONVITE.test(trecho);
}

/**
 * Link que a equipe copia e manda para a empresa. A base é sempre o endereço oficial
 * (KICKOFF_PUBLIC_BASE_URL, montado no servidor em enderecoPublico.ts), nunca o
 * domínio do navegador de quem copia.
 */
export function linkDoAgendamento(origem: string, codigo: string): string {
  return `${origem.replace(/\/+$/, '')}/impulsao/agendar/${codigo}`;
}

/**
 * Endereço da Legacy para entrar na reunião (Zoom E2): encaminha ao link individual
 * do Zoom da empresa do convite, só no horário da sessão da reserva.
 */
export function linkDaReuniao(origem: string, codigo: string): string {
  return `${origem.replace(/\/+$/, '')}/impulsao/reuniao/${codigo}`;
}

export interface AnfitriaoPublico {
  nome: string;
  /** https ou null (iniciais). */
  foto: string | null;
}

export interface ReservaPublica {
  /** YYYY-MM-DD, Brasília. */
  data: string;
  /** HH:MM, Brasília. */
  inicio: string;
  fim: string;
  starts_at: string;
  participante: string;
  anfitriao: AnfitriaoPublico | null;
}

export interface SessaoPublica {
  id: string;
  data: string;
  inicio: string;
  fim: string;
  starts_at: string;
  vagas: number;
  anfitriao: AnfitriaoPublico | null;
}

export type SituacaoDoConvite = 'disponivel' | 'reservada' | 'concluida';

export interface PaginaDoConvite {
  status: 'ok';
  empresa: { nome: string };
  situacao: SituacaoDoConvite;
  /** Convite vencido: só consulta a reserva (ativa ou concluída), não agenda. */
  expirado: boolean;
  reserva: ReservaPublica | null;
  sessoes: SessaoPublica[];
  /** Acesso à reunião da reserva ativa (Zoom E2); ausente sem reserva ou sem a estrutura. */
  acesso?: AcessoPublico;
}

export type RecusaDoConvite = 'convite_invalido' | 'convite_revogado' | 'convite_expirado' | 'muitas_tentativas';

export type RespostaDoConvite = PaginaDoConvite | { status: RecusaDoConvite };

export type StatusDoAgendamento =
  | 'ok'
  | 'ja_inscrita'
  | 'concluida'
  | 'sessao_lotada'
  | 'sessao_indisponivel'
  | 'dados_invalidos'
  | RecusaDoConvite;

export interface RespostaDoAgendamento {
  status: StatusDoAgendamento;
  mensagem?: string;
  reserva?: ReservaPublica;
  /** Acesso à reunião, logo depois de agendar (Zoom E2). */
  acesso?: AcessoPublico;
}

export const RECUSAS: readonly RecusaDoConvite[] = ['convite_invalido', 'convite_revogado', 'convite_expirado', 'muitas_tentativas'];

/** O link não abre: título e explicação para o visitante. */
export const AVISO_DA_RECUSA: Record<RecusaDoConvite, { titulo: string; texto: string }> = {
  convite_invalido: {
    titulo: 'Link inválido',
    texto: 'Não encontramos este link de agendamento. Confira se ele foi copiado inteiro ou peça um novo ao time da Legacy.',
  },
  convite_revogado: {
    titulo: 'Este link foi substituído',
    texto: 'Ele não vale mais. Peça o link atualizado ao time da Legacy.',
  },
  convite_expirado: {
    titulo: 'Este link expirou',
    texto: 'O prazo deste link de agendamento acabou. Peça um link novo ao time da Legacy.',
  },
  muitas_tentativas: {
    titulo: 'Muitas tentativas seguidas',
    texto: 'Por segurança, aguarde 15 minutos e abra o link de novo.',
  },
};

export const KICKOFF_CONCLUIDO =
  'O kickoff da sua empresa já foi concluído. Se precisar de ajuda, fale com o time da Legacy.';

/** Mensagem para o que a confirmação recusou e a página continua aberta. Null = troca de tela. */
export function avisoDoAgendamento(r: RespostaDoAgendamento): string | null {
  switch (r.status) {
    case 'sessao_lotada':
      return 'Este horário acabou de lotar. Escolha outro.';
    case 'sessao_indisponivel':
      return 'Este horário não está mais disponível. Escolha outro.';
    case 'dados_invalidos':
      return r.mensagem ?? 'Confira os dados de quem vai participar.';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Datas (sempre texto YYYY-MM-DD de Brasília; o navegador não converte fuso)
// ---------------------------------------------------------------------------

export const DIAS_DA_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'] as const;
export const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
export const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora);
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${de('year')}-${de('month')}-${de('day')}`;
}

/** Soma dias a um YYYY-MM-DD sem passar por UTC. */
export function somarDias(data: string, dias: number): string {
  const [y, m, d] = data.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dias);
  return [dt.getFullYear(), String(dt.getMonth() + 1).padStart(2, '0'), String(dt.getDate()).padStart(2, '0')].join('-');
}

export function diaDaSemanaDe(data: string): number {
  const [y, m, d] = data.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** "2026-11-11" -> "11/11". */
export function diaMes(data: string): string {
  const [, m, d] = data.split('-');
  return `${d}/${m}`;
}

/** "2026-11-11" -> "qua, 11/11". */
export function dataCurta(data: string): string {
  return `${DIAS_CURTOS[diaDaSemanaDe(data)]}, ${diaMes(data)}`;
}

/** "2026-11-17" -> "Terça-feira, 17 de novembro". */
export function dataPorExtenso(data: string): string {
  const [, m, d] = data.split('-').map(Number);
  return `${DIAS_DA_SEMANA[diaDaSemanaDe(data)]}, ${d} de ${MESES[m - 1]}`;
}

export function vagas(n: number): string {
  return n === 1 ? '1 vaga' : `${n} vagas`;
}

/** "Ana Paula Souza" -> "AS"; um nome só -> uma letra. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '';
  return `${partes[0][0]}${partes.length > 1 ? partes[partes.length - 1][0] : ''}`.toUpperCase();
}

/** Minutos entre "HH:MM" de início e fim (atravessa a meia-noite se precisar). */
export function minutosEntre(inicio: string, fim: string): number {
  const emMinutos = (h: string) => {
    const [hh, mm] = h.split(':').map(Number);
    return hh * 60 + mm;
  };
  const d = emMinutos(fim) - emMinutos(inicio);
  return d >= 0 ? d : d + 24 * 60;
}

/** 60 -> "1 hora", 90 -> "1 h 30 min", 45 -> "45 minutos". */
export function duracaoPorExtenso(minutos: number): string {
  if (minutos < 60) return `${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (resto === 0) return horas === 1 ? '1 hora' : `${horas} horas`;
  return `${horas} h ${resto} min`;
}

/** Duração que vale para todos os horários; null se variar ou não houver. */
export function duracaoComum(sessoes: Pick<SessaoPublica, 'inicio' | 'fim'>[]): number | null {
  const duracoes = new Set(sessoes.map((s) => minutosEntre(s.inicio, s.fim)));
  return duracoes.size === 1 ? [...duracoes][0] : null;
}

/** Anfitrião que vale para todos os horários (para o painel lateral); null se variar. */
export function anfitriaoComum(sessoes: Pick<SessaoPublica, 'anfitriao'>[]): AnfitriaoPublico | null {
  const nomes = new Set(sessoes.map((s) => s.anfitriao?.nome ?? ''));
  return nomes.size === 1 ? (sessoes[0]?.anfitriao ?? null) : null;
}

export interface DiaDoAgendamento {
  data: string;
  titulo: string;
  sessoes: SessaoPublica[];
}

/** Sessões agrupadas por dia, na ordem em que acontecem. */
export function sessoesPorDia(sessoes: SessaoPublica[]): DiaDoAgendamento[] {
  const dias: DiaDoAgendamento[] = [];
  for (const s of [...sessoes].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.data === s.data) ultimo.sessoes.push(s);
    else dias.push({ data: s.data, titulo: dataPorExtenso(s.data), sessoes: [s] });
  }
  return dias;
}
