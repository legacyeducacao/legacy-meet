/**
 * Sessão de kickoff como evento da agenda (regra pura, testável).
 * A sessão é uma reunião da agenda, mas sem a sala do Meet (o kickoff usa
 * Zoom), sem a empresa organizadora interna à mostra e, para quem não
 * gerencia kickoffs, sem os detalhes internos.
 */
import type { EventoDTO } from '@/lib/agenda/tipos';
import { KICKOFF_TIPO } from './regras';

export interface InfoKickoff {
  capacidade: number;
  aceitaReservas: boolean;
  /** Empresas com reserva ativa (M2). */
  ocupadas?: number;
}

export function marcarEventoKickoff(ev: EventoDTO, info: InfoKickoff, gerencia: boolean): EventoDTO {
  return {
    ...ev,
    calendario: 'kickoff',
    tipoEvento: KICKOFF_TIPO,
    // Sem sala do Meet: sem "Entrar", sem link de convidado.
    roomName: undefined,
    // A empresa organizadora é interna; as participantes vêm nas reservas (M2).
    tenantId: null,
    cliente: null,
    gravar: false,
    transcrever: false,
    onboarding: false,
    podeEditar: ev.status === 'scheduled' && gerencia,
    // Ocupação e configuração só para quem gerencia kickoffs.
    kickoff: gerencia ? { capacidade: info.capacidade, aceitaReservas: info.aceitaReservas, ocupadas: info.ocupadas ?? 0 } : undefined,
  };
}

/** Ocupação curta ("3/5") para a agenda; só existe para quem gerencia kickoffs. */
export function ocupacaoCurta(ev: Pick<EventoDTO, 'kickoff'>): string | null {
  return ev.kickoff ? `${ev.kickoff.ocupadas}/${ev.kickoff.capacidade}` : null;
}

export type FiltroTipo = 'todos' | 'comuns' | 'kickoffs';

/** Filtro visual da agenda. Só muda o que aparece na tela, nunca a disponibilidade. */
export function passaNoFiltro(ev: Pick<EventoDTO, 'tipoEvento'>, filtro: FiltroTipo): boolean {
  const kickoff = ev.tipoEvento === KICKOFF_TIPO;
  if (filtro === 'comuns') return !kickoff;
  if (filtro === 'kickoffs') return kickoff;
  return true;
}
