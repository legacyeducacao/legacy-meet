/**
 * "Sincronizar presença do Zoom" (Zoom E3) no servidor. Só quem gerencia kickoffs
 * chega aqui (a rota confere com gestorDeKickoff e o banco confere de novo).
 *
 * Fluxo (sob demanda, sem rotina automática):
 *   1. banco: contexto da sessão (agenda_kickoff_zoom_presenca_contexto);
 *   2. Zoom, SÓ LEITURA: execuções passadas da reunião, relatório de cada execução
 *      que cruza a janela da sessão e os participantes (com registrant_id);
 *   3. apuração pura (zoomPresenca.ts);
 *   4. banco: aplica (agenda_kickoff_zoom_presenca_aplicar), que só registra
 *      "presente" onde é permitido e devolve o resultado por reserva.
 *
 * Nada do Zoom é criado ou alterado. Nomes e e-mails dos participantes não vão para
 * log; para a tela vão só o nome da empresa e, nos não identificados, o nome que a
 * pessoa usou no Zoom (a equipe precisa dele para conferir).
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { ZoomApiError, type ZoomClient } from '@/lib/zoom/api';
import { ehUuid, type Resultado } from './reservas';
import { erroDoBanco } from './reservasRegras';
import { credenciaisDoZoom } from './zoomSala';
import { clienteZoom } from './zoomSalaServidor';
import { apurarPresenca, janelaDaSessao, type ContextoDaPresenca, type ExecucaoLida, type NaoIdentificado } from './zoomPresenca';

export type ChamarBanco = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
type ZoomDaPresenca = Pick<ZoomClient, 'listPastInstances' | 'getMeetingReport' | 'listReportParticipants'>;

const falhou = (status: number, message: string) => ({ ok: false as const, status, message });

class ErroDoBanco extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const chamarPeloSupabase: ChamarBanco = async (fn, args) => {
  const { data, error } = await createAdminSupabase().rpc(fn, args);
  if (error) throw new ErroDoBanco(error.code ?? '', error.message ?? '');
  return data;
};

export type ResultadoDaEmpresa = 'registrada' | 'ja_registrada' | 'preservada' | 'revisar';

export interface ResumoDaSincronizacao {
  sessaoId: string;
  /** Execuções do Zoom associadas à sessão. */
  execucoes: Array<{ inicio: string; fim: string | null; participantes: number | null; compartilhada: boolean; relatorio: 'ok' | 'indisponivel' }>;
  /** Uma linha por empresa da sessão com participação identificada. */
  empresas: Array<{
    reservaId: string;
    empresa: string;
    resultado: ResultadoDaEmpresa;
    detalhe: string | null;
    evidencia: 'registrante' | 'email';
    entradas: number;
    duracaoMin: number;
  }>;
  /** Empresas com reserva ativa e sem participação identificada (seguem sem registro). */
  pendentes: string[];
  /** Empresas que entraram, mas cuja reserva não é desta sessão (nada registrado). */
  foraDaSessao: string[];
  /** Entradas que não deu para ligar a uma empresa. */
  naoIdentificados: NaoIdentificado[];
  /** O relatório pode mudar: sessão ainda na janela ou relatório do Zoom indisponível. */
  incompleta: boolean;
}

/** Falha do banco -> resposta. 008 não aplicada vira 503 com a explicação certa. */
function falhaDoBanco(e: unknown) {
  const code = e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : '';
  if (!code) return falhou(500, 'Falha ao sincronizar a presença.');
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(code)) {
    return falhou(503, 'A presença pelo Zoom ainda não foi instalada no banco (migration 008 pendente).');
  }
  return { ok: false as const, ...erroDoBanco({ code, message: (e as Error).message }) };
}

function falhaDoZoom(e: unknown) {
  if (e instanceof ZoomApiError) {
    if (e.status === 429) return falhou(503, `O Zoom pediu para esperar${e.esperarSegundos ? ` ${e.esperarSegundos} s` : ''}. Tente de novo em instantes.`);
    if (e.status === 0) return falhou(503, 'O Zoom não respondeu. Tente de novo em instantes.');
    if (e.origem === 'oauth') return falhou(502, 'O Zoom recusou as credenciais da integração.');
    if (e.status === 400 || e.status === 401 || e.status === 403) {
      return falhou(502, `O Zoom recusou a leitura dos relatórios (HTTP ${e.status}). Confira os escopos de relatório do app Zoom.`);
    }
    return falhou(502, `O Zoom respondeu com erro (HTTP ${e.status}).`);
  }
  return falhou(502, 'Falha ao ler os relatórios do Zoom.');
}

/** "Reunião não existe" ou relatório ainda não gerado: não é erro, é relatório indisponível. */
const naoDisponivel = (e: unknown) => e instanceof ZoomApiError && (e.status === 404 || e.code === 3001 || e.code === 12702);

function lerContexto(v: unknown): ContextoDaPresenca | null {
  const c = v as Partial<ContextoDaPresenca> | null;
  if (!c || typeof c !== 'object' || !c.sessao || typeof c.sessao.inicio !== 'string' || typeof c.sessao.fim !== 'string') return null;
  return {
    sessao: c.sessao,
    outras: Array.isArray(c.outras) ? c.outras : [],
    salas: Array.isArray(c.salas) ? c.salas.filter((s): s is string => typeof s === 'string' && /^\d{9,12}$/.test(s)) : [],
    inscricoes: Array.isArray(c.inscricoes) ? c.inscricoes : [],
    reservas: Array.isArray(c.reservas) ? c.reservas : [],
  };
}

/** Lê no Zoom as execuções que podem cruzar a janela da sessão, com os participantes. */
async function lerExecucoes(zoom: ZoomDaPresenca, ctx: ContextoDaPresenca): Promise<ExecucaoLida[]> {
  const j = janelaDaSessao(ctx.sessao);
  // Uma execução não dura mais de 24 h: começou até 24 h antes da janela.
  const desde = j.inicio - 24 * 3_600_000;
  const lidas: ExecucaoLida[] = [];
  for (const sala of ctx.salas) {
    let instancias: Awaited<ReturnType<ZoomDaPresenca['listPastInstances']>>;
    try {
      instancias = await zoom.listPastInstances(sala);
    } catch (e) {
      if (naoDisponivel(e)) continue;
      throw e;
    }
    for (const inst of instancias) {
      const inicio = Date.parse(inst.start_time ?? '');
      if (!Number.isFinite(inicio) || inicio < desde || inicio >= j.fim) continue;
      let fim: string | null = null;
      let anfitriao: string | null = null;
      let relatorio: 'ok' | 'indisponivel' = 'ok';
      try {
        const r = await zoom.getMeetingReport(inst.uuid);
        fim = typeof r.end_time === 'string' && Number.isFinite(Date.parse(r.end_time)) ? r.end_time : null;
        anfitriao = typeof r.user_email === 'string' ? r.user_email : null;
      } catch (e) {
        if (!naoDisponivel(e)) throw e;
        relatorio = 'indisponivel';
      }
      // Execução que terminou antes da janela: de outra sessão.
      if (fim && Date.parse(fim) <= j.inicio) continue;
      let participantes: ExecucaoLida['participantes'] = [];
      if (relatorio === 'ok') {
        try {
          participantes = await zoom.listReportParticipants(inst.uuid);
        } catch (e) {
          if (!naoDisponivel(e)) throw e;
          relatorio = 'indisponivel';
        }
      }
      lidas.push({ zoom_meeting_id: sala, uuid: inst.uuid, inicio: new Date(inicio).toISOString(), fim, relatorio, emailDoAnfitriao: anfitriao, participantes });
    }
  }
  return lidas;
}

export async function sincronizarPresenca(
  usuarioId: string,
  sessaoId: string,
  deps: { zoom?: ZoomDaPresenca; chamar?: ChamarBanco; agora?: () => number; env?: Record<string, string | undefined> } = {},
): Promise<Resultado<ResumoDaSincronizacao>> {
  if (!ehUuid(sessaoId)) return falhou(404, 'Sessão de kickoff não encontrada.');
  const chamar = deps.chamar ?? chamarPeloSupabase;
  const agora = deps.agora ?? (() => Date.now());

  let zoom = deps.zoom;
  if (!zoom) {
    const c = credenciaisDoZoom(deps.env ?? process.env);
    if (!c.ok) return falhou(409, `Integração Zoom não configurada no servidor: falta ${c.faltando.join(', ')}.`);
    zoom = clienteZoom(c.credenciais);
  }

  let ctx: ContextoDaPresenca | null;
  try {
    ctx = lerContexto(await chamar('agenda_kickoff_zoom_presenca_contexto', { p_meeting_id: sessaoId, p_usuario: usuarioId }));
  } catch (e) {
    return falhaDoBanco(e);
  }
  if (!ctx) return falhou(500, 'Falha ao ler a sessão.');
  if (!ctx.salas.length) return falhou(409, 'Nenhuma sala Zoom dos kickoffs para consultar. Ative a sala no quadro “Sala Zoom”.');

  let lidas: ExecucaoLida[];
  try {
    lidas = await lerExecucoes(zoom, ctx);
  } catch (e) {
    return falhaDoZoom(e);
  }

  const a = apurarPresenca(ctx, lidas, agora());

  let aplicado: { itens?: Array<{ reserva_id: string; tenant_id: string; resultado: ResultadoDaEmpresa; detalhe: string | null }>; fora_da_sessao?: Array<{ empresa: string }>; pendentes?: Array<{ reserva_id: string }> };
  try {
    aplicado = (await chamar('agenda_kickoff_zoom_presenca_aplicar', {
      p_meeting_id: sessaoId,
      p_execucoes: a.execucoes,
      p_empresas: a.empresas.map(({ empresa: _empresa, ...resto }) => resto),
      p_usuario: usuarioId,
    })) as typeof aplicado;
  } catch (e) {
    return falhaDoBanco(e);
  }

  const evidencia = new Map(a.empresas.map((e) => [e.tenant_id, e]));
  const empresaDaReserva = new Map(ctx.reservas.map((r) => [r.reserva_id, r.empresa]));
  return {
    ok: true,
    dados: {
      sessaoId,
      execucoes: a.execucoes.map((e) => ({ inicio: e.inicio, fim: e.fim, participantes: e.participantes, compartilhada: e.compartilhada, relatorio: e.relatorio })),
      empresas: (aplicado?.itens ?? []).map((i) => {
        const ev = evidencia.get(i.tenant_id);
        return {
          reservaId: i.reserva_id,
          empresa: empresaDaReserva.get(i.reserva_id) ?? ev?.empresa ?? 'Empresa',
          resultado: i.resultado,
          detalhe: i.detalhe,
          evidencia: ev?.evidencia ?? 'registrante',
          entradas: ev?.entradas ?? 0,
          duracaoMin: Math.round((ev?.duracao_s ?? 0) / 60),
        };
      }),
      pendentes: (aplicado?.pendentes ?? []).map((p) => empresaDaReserva.get(p.reserva_id) ?? 'Empresa'),
      foraDaSessao: (aplicado?.fora_da_sessao ?? []).map((f) => f.empresa),
      naoIdentificados: a.naoIdentificados,
      incompleta: a.incompleta,
    },
  };
}
