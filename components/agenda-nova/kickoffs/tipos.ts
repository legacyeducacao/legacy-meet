/** Tipos da seção Kickoffs Impulsão (o que a API /api/agenda/kickoffs devolve). */
import type { Presenca, StatusReserva } from '@/lib/kickoff/reservasRegras';
import type { AcessoDaReserva } from '@/lib/kickoff/zoomAcessoRegras';

export interface ReservaTela {
  id: string;
  sessaoId: string;
  empresa: { id: string; nome: string };
  participante: { nome: string; email: string; telefone: string | null };
  status: StatusReserva;
  presenca: Presenca | null;
  presencaEm: string | null;
  interrompidaEm: string | null;
  motivoInterrupcao: string | null;
  concluidaEm: string | null;
  origemReservaId: string | null;
  reagendada: boolean;
  criadoEm: string;
  canceladaEm: string | null;
  motivoCancelamento: string | null;
  /** Acesso Zoom (só reserva ativa, com a migration 007). Nunca traz o link do Zoom. */
  acesso?: AcessoDaReserva | null;
}

export interface ZoomDoPainel {
  estrutura: 'ok' | 'pendente';
  integracao: { configurada: boolean; faltando: string[] };
  sala: { verificacaoOk: boolean } | null;
}

export interface SessaoTela {
  id: string;
  titulo: string;
  inicio: string;
  fim: string;
  status: string;
  anfitriao: string | null;
  serieId: string | null;
  capacidade: number;
  aceitaReservas: boolean;
  ocupadas: number;
  reservas: ReservaTela[];
}

export interface RespostaKickoffs {
  estrutura: 'ok' | 'pendente';
  estruturaReservas: 'ok' | 'pendente';
  estruturaConvites?: 'ok' | 'pendente';
  zoom?: ZoomDoPainel | null;
  configuracao: {
    organizador: { configurado: boolean; encontrado: boolean; nome: string | null };
    capacidadePadrao: number;
    duracaoPadraoMin: number;
  };
  sessoes: SessaoTela[];
}

export const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export async function textoErro(res: Response) {
  return (await res.text().catch(() => '')) || 'Algo deu errado. Tente de novo.';
}
