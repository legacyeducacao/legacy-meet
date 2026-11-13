/**
 * Reservas do kickoff (M2): regras puras, usadas pelo servidor, pela tela e pelos
 * testes. As regras que valem de verdade estão no banco
 * (integracoes/kickoff/003_kickoff_reservas.sql); aqui só o que ajuda a tela a
 * avisar antes e o servidor a traduzir as respostas do banco.
 */

/**
 * ativa: vaga reservada, resultado ainda não registrado (mesmo depois do horário);
 * cancelada: desistiu antes de comparecer; ausente: não compareceu (pode reagendar);
 * interrompida: compareceu e não concluiu, com motivo (pode reagendar);
 * concluida: kickoff concluído (definitivo; a empresa não reserva outro).
 */
export type StatusReserva = 'ativa' | 'cancelada' | 'ausente' | 'interrompida' | 'concluida';
export type Presenca = 'presente' | 'ausente';

export type SituacaoSessao = 'aberta' | 'lotada' | 'bloqueada' | 'em_andamento' | 'encerrada' | 'cancelada';

/** Mesmo padrão de e-mail do banco (check da tabela). */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TELEFONE = /^\+?[0-9 ().-]+$/;

export interface Participante {
  nome: string;
  email: string;
  telefone: string | null;
}

/** Normaliza e valida como o banco; devolve a mensagem do primeiro problema. */
export function validarParticipante(p: { nome?: unknown; email?: unknown; telefone?: unknown }):
  | { ok: true; participante: Participante }
  | { ok: false; message: string } {
  const nome = typeof p.nome === 'string' ? p.nome.trim() : '';
  const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
  const telefone = typeof p.telefone === 'string' && p.telefone.trim() ? p.telefone.trim() : null;
  if (nome.length < 2 || nome.length > 200) return { ok: false, message: 'Informe o nome do participante principal (2 a 200 caracteres).' };
  if (!email) return { ok: false, message: 'Informe o e-mail do participante principal.' };
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, message: 'E-mail do participante inválido.' };
  if (telefone !== null) {
    const digitos = telefone.replace(/\D/g, '').length;
    if (!TELEFONE.test(telefone) || digitos < 8 || digitos > 15) {
      return { ok: false, message: 'Telefone/WhatsApp do participante inválido (8 a 15 dígitos).' };
    }
  }
  return { ok: true, participante: { nome, email, telefone } };
}

/** Situação da sessão para reservas (a mesma ordem de checagem do banco). */
export function situacaoDaSessao(
  s: { status: string; inicio: string; fim?: string; capacidade: number; aceitaReservas: boolean; ocupadas: number },
  agora: number = Date.now(),
): SituacaoSessao {
  if (s.status === 'canceled') return 'cancelada';
  if (s.status === 'scheduled' && Date.parse(s.inicio) <= agora && s.fim && Date.parse(s.fim) > agora) return 'em_andamento';
  if (s.status !== 'scheduled' || Date.parse(s.inicio) <= agora) return 'encerrada';
  if (!s.aceitaReservas) return 'bloqueada';
  if (s.ocupadas >= s.capacidade) return 'lotada';
  return 'aberta';
}

export const ROTULO_SITUACAO: Record<SituacaoSessao, string> = {
  aberta: 'Com vagas',
  lotada: 'Lotada',
  bloqueada: 'Bloqueada para novas reservas',
  em_andamento: 'Em andamento',
  encerrada: 'Encerrada',
  cancelada: 'Cancelada',
};

/** O que a tela mostra de uma reserva (presença registrada não é conclusão). */
export function rotuloReserva(r: { status: StatusReserva; presenca: Presenca | null }): string {
  if (r.status === 'concluida') return 'Kickoff concluído';
  if (r.status === 'ausente') return 'Não compareceu';
  if (r.status === 'interrompida') return 'Participou, não concluiu';
  if (r.status === 'cancelada') return 'Cancelada';
  return r.presenca === 'presente' ? 'Compareceu (conclusão pendente)' : 'Reservada';
}

/** O que pode ser feito com a reserva agora (o banco confere de novo). */
export function acoesDaReserva(
  r: { status: StatusReserva; presenca: Presenca | null; reagendada?: boolean },
  sessao: { inicio: string; fim: string },
  agora: number = Date.now(),
) {
  const ativa = r.status === 'ativa';
  const comecou = Date.parse(sessao.inicio) <= agora;
  const terminou = Date.parse(sessao.fim) <= agora;
  return {
    remanejar: ativa && r.presenca === null,
    // Depois de comparecer não se cancela: concluir ou registrar a interrupção.
    cancelar: ativa && r.presenca === null,
    presente: ativa && r.presenca === null && comecou,
    ausente: ativa && r.presenca === null && terminou,
    concluir: ativa && r.presenca === 'presente',
    interromper: ativa && r.presenca === 'presente',
    corrigirPresenca: (ativa && r.presenca !== null) || (r.status === 'ausente' && !r.reagendada),
    reagendar: (r.status === 'ausente' || r.status === 'interrompida') && !r.reagendada,
    participante: r.status !== 'cancelada',
  };
}

/**
 * Reservas da sessão que esperam o resultado (comparecimento, conclusão ou
 * interrupção) depois que a sessão terminou. Nada é concluído pelo horário.
 */
export function pendenciasDaSessao(
  s: { status: string; fim: string; reservas: Array<{ status: StatusReserva }> },
  agora: number = Date.now(),
): number {
  if (s.status === 'canceled' || Date.parse(s.fim) > agora) return 0;
  return s.reservas.filter((r) => r.status === 'ativa').length;
}

/** Erro do banco (PostgREST) -> status HTTP + mensagem para a tela. */
export function erroDoBanco(e: { code?: string | null; message?: string | null } | null | undefined): { status: number; message: string } {
  const code = e?.code ?? '';
  const message = e?.message?.trim() || 'Falha ao gravar no banco';
  switch (code) {
    case '42501':
      return { status: 403, message };
    case 'P0002':
      return { status: 404, message };
    case '23505':
      return {
        status: 409,
        message: message.includes('agenda_kickoff_reservas_empresa_key') ? 'Esta empresa já tem um kickoff marcado ou concluído.' : message,
      };
    // Regra de negócio (sessão lotada, passada, com reservas...). 422, e não 409:
    // na agenda, 409 é o conflito de horário com justificativa.
    case '22023':
      return { status: 422, message };
    case '23514':
    case '23502':
      return { status: 400, message: 'Dados do participante inválidos.' };
    case '23001':
    case '23503':
      return { status: 409, message: 'A sessão tem reservas: não pode ser apagada.' };
    // Função ou tabela ainda não existe: migration das reservas pendente.
    case 'PGRST202':
    case '42883':
    case '42P01':
    case 'PGRST205':
      return { status: 503, message: 'As reservas de kickoff ainda não foram instaladas no banco (migration 003 pendente).' };
    default:
      return { status: 500, message };
  }
}
