/**
 * Inscrição do participante na sala Zoom dos kickoffs (Zoom E2): o acesso individual.
 * Sem rede, banco ou process.env: o Zoom e o banco chegam por parâmetro, e tudo é
 * testado com o banco de verdade (PGlite) e um Zoom falso.
 *
 * Adaptado do Legacy CS (src/lib/kickoffs-zoom-inscricao.ts, guia técnico, Apêndice C),
 * que reaproveita as regras do Legacy Plan: código da empresa, nome no Zoom
 * ("Nome | Empresa #CÓDIGO"), quando procurar a inscrição pelo e-mail e quando ela
 * ainda serve. O que muda no Meet:
 *   - a empresa é client_tenants.id (o código são os 8 primeiros hexadecimais dele);
 *   - a configuração da sala é conferida pelo mesmo validador da E1 (avaliarSala);
 *   - o link individual nunca sai daqui para telas ou respostas JSON: só o servidor
 *     o usa, para encaminhar o participante em /impulsao/reuniao/<código>.
 *
 * Reserva x inscrição: a RESERVA é da empresa numa sessão (data, horário, anfitrião).
 * A INSCRIÇÃO é de um e-mail na sala Zoom, que é a mesma para todas as sessões.
 */
import { ZoomApiError, type ZoomClient, type ZoomRegistrant } from '@/lib/zoom/api';
import { avaliarSala } from './zoomSala';

// ---------------------------------------------------------------------------
// Identidade no Zoom (regras do Plan, como no CS)
// ---------------------------------------------------------------------------

/** Limite do Zoom para first_name e last_name do registrante. */
export const ZOOM_NOME_MAX = 64;

/**
 * Código curto e estável da empresa no Zoom: os 8 primeiros hexadecimais de
 * client_tenants.id, em maiúsculas. É o MESMO código que o Plan põe nas turmas:
 * um prefixo do id, não um hash. Nunca vem do navegador.
 */
export function codigoDaEmpresa(tenantId: string): string {
  const hex = tenantId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('tenant_id inválido');
  return hex.slice(0, 8).toUpperCase();
}

// Separadores do formato não podem aparecer dentro das partes.
const limpar = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/[|#[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cortar = (s: string, max: number) => {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, Math.max(0, max));
  return s.slice(0, max - 1).trimEnd() + '…';
};

export interface IdentidadeNoZoom {
  first_name: string;
  last_name: string;
  org: string;
  codigo: string;
  /** Como o Zoom exibe: first_name + ' ' + last_name. */
  nomeExibido: string;
}

/**
 * Nome que vai para o Zoom: "Maria Silva | Padaria Pão Bom #1A2B3C4D".
 * Passando de 64 caracteres: o código nunca é cortado; a empresa guarda até 32
 * caracteres; o sobrenome cede primeiro.
 */
export function identidadeNoZoom(e: { participante: string | null | undefined; email: string; empresa: string | null | undefined; tenantId: string }): IdentidadeNoZoom {
  const codigo = codigoDaEmpresa(e.tenantId);
  const nomeCompleto = limpar(e.participante) || limpar(e.email.split('@')[0]) || 'Participante';
  const [primeiroBruto, ...resto] = nomeCompleto.split(' ');
  const primeiro = cortar(primeiroBruto, ZOOM_NOME_MAX);
  let sobrenome = resto.join(' ');
  let empresa = limpar(e.empresa) || 'Empresa';

  const fim = ` #${codigo}`;
  const sep = '| ';
  const MIN_EMPRESA = 32;
  const montar = () => `${sobrenome ? `${sobrenome} ` : ''}${sep}${empresa}${fim}`;

  if (montar().length > ZOOM_NOME_MAX) {
    const espaco = ZOOM_NOME_MAX - fim.length - sep.length;
    const empresaFica = Math.min(empresa.length, Math.max(MIN_EMPRESA, espaco - (sobrenome ? sobrenome.length + 1 : 0)));
    const sobra = espaco - empresaFica - 1;
    sobrenome = sobra > 0 ? cortar(sobrenome, sobra) : '';
    empresa = cortar(empresa, espaco - (sobrenome ? sobrenome.length + 1 : 0));
  }

  const ultimo = montar();
  return { first_name: primeiro, last_name: ultimo, org: cortar(empresa, ZOOM_NOME_MAX), codigo, nomeExibido: `${primeiro} ${ultimo}` };
}

const CODIGO_NO_NOME = /#([0-9A-F]{8})(?![0-9A-F])/i;

/** Código "#XXXXXXXX" no nome exibido no Zoom (é por ele que a E3 vai reconhecer a empresa). */
export function codigoNoNome(nome?: string | null): string | null {
  const m = CODIGO_NO_NOME.exec(nome ?? '');
  return m ? m[1].toUpperCase() : null;
}

/** A inscrição guardada ainda serve? Só aprovada (ou sem status). */
export const inscricaoAindaServe = (status: string | undefined) => status === undefined || status === 'approved';

/** Falha do POST que vale a pena resolver procurando a inscrição pelo e-mail. */
export function valeProcurarPeloEmail(err: unknown): boolean {
  if (!(err instanceof ZoomApiError)) return false;
  if (err.status === 0 || err.status === 404 || err.status === 429 || err.status >= 500) return false;
  if (err.status === 401 || err.status === 403) return false;
  return err.status >= 400;
}

/** Falha do Zoom -> mensagem segura para a EQUIPE (nunca vai ao cliente; nunca texto do Zoom). */
export function descreverFalhaDaInscricao(err: unknown): string {
  if (err instanceof ZoomApiError) {
    if (err.origem === 'oauth' && err.status !== 0 && err.status !== 429 && err.status < 500) {
      return 'O Zoom recusou as credenciais do servidor. Confira a integração no quadro Sala Zoom.';
    }
    if (err.status === 404 || err.code === 3001) return 'Reunião da sala Zoom não encontrada. Confira o quadro Sala Zoom.';
    if (err.status === 0) return 'Não foi possível falar com o Zoom agora.';
    if (err.status === 429) return 'O Zoom limitou as chamadas agora. Tente de novo em alguns segundos.';
    if (err.status >= 500) return 'O Zoom está com instabilidade. Tente de novo em instantes.';
    if (err.status === 401 || err.status === 403) return 'A integração com o Zoom está sem permissão para inscrever. Confira as credenciais e os escopos do app.';
    return `O Zoom recusou a inscrição (código ${err.code ?? err.status}).`;
  }
  return 'Não foi possível gerar o acesso ao Zoom agora.';
}

/** Só encaminhamos para o Zoom: nunca para outro endereço que tenha ido parar no banco. */
export function ehLinkDoZoom(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2000) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && /^([a-z0-9-]+\.)*zoom\.us$/i.test(u.hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Contrato com o banco (funções agenda_kickoff_zoom_inscricao_* da migration 007)
// ---------------------------------------------------------------------------

export type MotivoIndisponivel = 'reserva_inativa' | 'sem_sala' | 'sala_com_problemas';

export interface ContextoDaInscricao {
  reserva_id: string;
  tenant_id: string;
  empresa: string;
  participante: string;
  email: string;
  zoom_meeting_id: string;
}

/** O que o banco decide antes de qualquer chamada ao Zoom. */
export type DecisaoDoBanco =
  | { acao: 'indisponivel'; motivo: MotivoIndisponivel }
  | { acao: 'conflito'; motivo: 'outra_empresa' | 'zoom' }
  | { acao: 'aguardar' }
  | { acao: 'aguardar_erro'; erro: string | null }
  | { acao: 'reaproveitar'; inscricao: { id: string; zoom_registrant_id: string; join_url: string; verificada_em: string | null }; contexto: ContextoDaInscricao }
  | { acao: 'criar'; inscricao: { id: string }; contexto: ContextoDaInscricao };

/**
 * normal: o pedido de sempre (agendamento, entrada na reunião).
 * tentar_de_novo: a equipe pediu de novo: ignora a espera depois de um erro e
 *   reavalia um conflito; nunca refaz uma inscrição pronta.
 * refazer: a inscrição pronta sumiu ou deixou de valer no Zoom: cria outra.
 */
export type ModoDoPedido = 'normal' | 'tentar_de_novo' | 'refazer';

export type ConclusaoDaInscricao =
  | { status: 'pronta'; zoomRegistrantId: string; joinUrl: string; nome: string | null; sobrenome: string | null; organizacao: string | null; nomeConfere: boolean }
  | { status: 'erro' | 'conflito'; erro: string };

export interface BancoDaInscricao {
  decidir(reservaId: string, modo: ModoDoPedido): Promise<DecisaoDoBanco>;
  /** Só conclui quem está com a inscrição em "criando". */
  concluir(inscricaoId: string, conclusao: ConclusaoDaInscricao): Promise<void>;
  marcarVerificada(inscricaoId: string): Promise<void>;
}

/** Chama uma função do banco e devolve o resultado; LANÇA o erro do banco (com `code`). */
export type ChamarBanco = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

/** usuarioId: quem pediu, quando é a equipe (o banco confere a permissão); null no fluxo da empresa. */
export function bancoDaInscricao(chamar: ChamarBanco, usuarioId: string | null): BancoDaInscricao {
  return {
    async decidir(reservaId, modo) {
      return (await chamar('agenda_kickoff_zoom_inscricao_decidir', { p_reserva_id: reservaId, p_modo: modo, p_usuario: usuarioId })) as DecisaoDoBanco;
    },
    async concluir(inscricaoId, c) {
      const pronta = c.status === 'pronta' ? c : null;
      await chamar('agenda_kickoff_zoom_inscricao_concluir', {
        p_id: inscricaoId,
        p_status: c.status,
        p_zoom_registrant_id: pronta?.zoomRegistrantId ?? null,
        p_join_url: pronta?.joinUrl ?? null,
        p_nome: pronta?.nome ?? null,
        p_sobrenome: pronta?.sobrenome ?? null,
        p_organizacao: pronta?.organizacao ?? null,
        p_nome_confere: pronta?.nomeConfere ?? null,
        p_erro: c.status === 'pronta' ? null : c.erro,
      });
    },
    async marcarVerificada(inscricaoId) {
      await chamar('agenda_kickoff_zoom_inscricao_verificada', { p_id: inscricaoId });
    },
  };
}

export type ZoomDaInscricao = Pick<ZoomClient, 'getMeeting' | 'addRegistrant' | 'getRegistrant' | 'findRegistrantByEmail'>;

/** joinUrl é CREDENCIAL: só o servidor usa, para encaminhar o participante. */
export type ResultadoDaInscricao =
  | { estado: 'pronto'; joinUrl: string; inscricaoId: string; reaproveitada: boolean }
  | { estado: 'erro'; mensagem: string }
  | { estado: 'preparando' }
  | { estado: 'conflito'; mensagem: string }
  | { estado: MotivoIndisponivel };

/** Inscrição pronta é conferida no Zoom no máximo a cada 6 horas. */
export const VERIFICAR_A_CADA_MS = 6 * 60 * 60 * 1000;

const MSG_OUTRA_EMPRESA = 'Este e-mail já tem acesso de outra empresa nesta sala. Revise o e-mail do participante.';
const MSG_CONFLITO_ZOOM = 'Este e-mail já está inscrito na sala Zoom com o código de outra empresa. Revise o e-mail do participante.';
const MSG_NAO_APROVADA = 'A inscrição no Zoom não está aprovada.';

type Deps = { zoom: ZoomDaInscricao; banco: BancoDaInscricao; agora?: () => number };

/**
 * Garante o acesso individual do participante principal da reserva: reaproveita a
 * inscrição existente ou cria uma. Falha do ZOOM nunca lança: vira { estado: "erro" }
 * com mensagem segura, gravada para a equipe ver. (Erro do banco na decisão lança:
 * quem chama decide o que responder.) A reserva nunca é tocada.
 */
export async function garantirInscricao(reservaId: string, deps: Deps, modo: ModoDoPedido = 'normal'): Promise<ResultadoDaInscricao> {
  const agora = deps.agora ?? (() => Date.now());
  const decisao = await deps.banco.decidir(reservaId, modo);
  switch (decisao.acao) {
    case 'indisponivel':
      return { estado: decisao.motivo };
    case 'conflito':
      return { estado: 'conflito', mensagem: decisao.motivo === 'outra_empresa' ? MSG_OUTRA_EMPRESA : MSG_CONFLITO_ZOOM };
    case 'aguardar':
      return { estado: 'preparando' };
    case 'aguardar_erro':
      return { estado: 'erro', mensagem: decisao.erro ?? descreverFalhaDaInscricao(null) };
    case 'reaproveitar':
      return reaproveitar(decisao, reservaId, deps, agora);
    case 'criar':
      return criar(decisao.inscricao.id, decisao.contexto, deps, agora);
  }
}

async function reaproveitar(
  d: Extract<DecisaoDoBanco, { acao: 'reaproveitar' }>,
  reservaId: string,
  deps: Deps,
  agora: () => number,
): Promise<ResultadoDaInscricao> {
  const pronto = { estado: 'pronto' as const, joinUrl: d.inscricao.join_url, inscricaoId: d.inscricao.id, reaproveitada: true };
  const verificada = d.inscricao.verificada_em ? Date.parse(d.inscricao.verificada_em) : NaN;
  if (Number.isFinite(verificada) && agora() - verificada < VERIFICAR_A_CADA_MS) return pronto;

  let reg: ZoomRegistrant;
  try {
    reg = await deps.zoom.getRegistrant(d.contexto.zoom_meeting_id, d.inscricao.zoom_registrant_id);
  } catch (err) {
    // Sumiu no Zoom: cria outra. Zoom fora do ar: o link guardado continua valendo
    // (entrar na reunião não depende de o Zoom responder a esta conferência).
    if (err instanceof ZoomApiError && err.status === 404) return refazer(reservaId, deps, agora);
    return pronto;
  }
  if (!inscricaoAindaServe(reg.status)) return refazer(reservaId, deps, agora);
  await deps.banco.marcarVerificada(d.inscricao.id).catch(() => undefined);
  return pronto;
}

async function refazer(reservaId: string, deps: Deps, agora: () => number): Promise<ResultadoDaInscricao> {
  const d = await deps.banco.decidir(reservaId, 'refazer');
  if (d.acao === 'criar') return criar(d.inscricao.id, d.contexto, deps, agora);
  if (d.acao === 'reaproveitar') return { estado: 'pronto', joinUrl: d.inscricao.join_url, inscricaoId: d.inscricao.id, reaproveitada: true };
  if (d.acao === 'indisponivel') return { estado: d.motivo };
  if (d.acao === 'conflito') return { estado: 'conflito', mensagem: d.motivo === 'outra_empresa' ? MSG_OUTRA_EMPRESA : MSG_CONFLITO_ZOOM };
  return { estado: 'preparando' };
}

async function criar(inscricaoId: string, ctx: ContextoDaInscricao, deps: Deps, agora: () => number): Promise<ResultadoDaInscricao> {
  const falhar = async (status: 'erro' | 'conflito', erro: string): Promise<ResultadoDaInscricao> => {
    await deps.banco.concluir(inscricaoId, { status, erro });
    return status === 'conflito' ? { estado: 'conflito', mensagem: erro } : { estado: 'erro', mensagem: erro };
  };

  try {
    // A sala pode ter mudado no Zoom depois de ativada: confere antes (mesmo validador da E1).
    const reuniao = await deps.zoom.getMeeting(ctx.zoom_meeting_id);
    const sala = avaliarSala(ctx.zoom_meeting_id, reuniao, new Date(agora()));
    if (!sala.ok) return await falhar('erro', `A sala Zoom deixou de aceitar inscrições: ${sala.problemas[0].titulo} Confira o quadro Sala Zoom.`);

    const identidade = identidadeNoZoom({ participante: ctx.participante, email: ctx.email, empresa: ctx.empresa, tenantId: ctx.tenant_id });

    let registrantId: string | undefined;
    let joinUrl: string | undefined;
    try {
      const criado = await deps.zoom.addRegistrant(ctx.zoom_meeting_id, {
        email: ctx.email,
        first_name: identidade.first_name,
        last_name: identidade.last_name,
        org: identidade.org,
      });
      registrantId = criado?.registrant_id;
      joinUrl = criado?.join_url;
    } catch (err) {
      // Resposta ambígua ou conflito: procura a inscrição que o Zoom já tem para este e-mail.
      if (!valeProcurarPeloEmail(err)) throw err;
      const achado = await deps.zoom.findRegistrantByEmail(ctx.zoom_meeting_id, ctx.email);
      if (!achado?.join_url || !inscricaoAindaServe(achado.status)) throw err;
      registrantId = achado.id;
      joinUrl = achado.join_url;
    }
    if (!registrantId || !ehLinkDoZoom(joinUrl)) throw new ZoomApiError(502, null, 'O Zoom não devolveu o link');

    // Confere no Zoom quem está inscrito com este e-mail (pode ser uma inscrição
    // antiga, feita por fora do Meet, com o código de OUTRA empresa).
    let noZoom: ZoomRegistrant | null = null;
    try {
      noZoom = await deps.zoom.getRegistrant(ctx.zoom_meeting_id, registrantId);
    } catch {
      noZoom = null; // conferência indisponível: vale o nome que mandamos
    }
    if (noZoom && !inscricaoAindaServe(noZoom.status)) return await falhar('erro', MSG_NAO_APROVADA);
    const nomeNoZoom = noZoom ? `${noZoom.first_name ?? ''} ${noZoom.last_name ?? ''}`.trim() : identidade.nomeExibido;
    const codigo = codigoNoNome(nomeNoZoom);
    if (codigo && codigo !== identidade.codigo) return await falhar('conflito', MSG_CONFLITO_ZOOM);

    await deps.banco.concluir(inscricaoId, {
      status: 'pronta',
      zoomRegistrantId: registrantId,
      joinUrl,
      nome: noZoom ? (noZoom.first_name ?? null) : identidade.first_name,
      sobrenome: noZoom ? (noZoom.last_name ?? null) : identidade.last_name,
      organizacao: identidade.org,
      nomeConfere: nomeNoZoom === identidade.nomeExibido,
    });
    return { estado: 'pronto', joinUrl, inscricaoId, reaproveitada: false };
  } catch (err) {
    const erro =
      err instanceof Error && err.message === 'tenant_id inválido' ? 'Código da empresa inválido: confira o cadastro da empresa.' : descreverFalhaDaInscricao(err);
    try {
      return await falhar('erro', erro);
    } catch {
      // Nem gravar o erro deu: a inscrição fica "criando" e é retomada depois de
      // 2 minutos pelo próximo pedido.
      return { estado: 'erro', mensagem: erro };
    }
  }
}

