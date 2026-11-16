/**
 * Acesso Zoom do kickoff (Zoom E2) no servidor (service_role + credenciais do Zoom).
 *
 * Quando o Zoom é chamado (e só nestes momentos):
 *   - a empresa acabou de confirmar a reserva pelo link do convite;
 *   - a empresa pediu de novo o acesso na página dela ("Tentar de novo");
 *   - a empresa clicou em "Entrar na reunião" (POST) dentro do horário da sessão;
 *   - a equipe clicou em gerar/recuperar o acesso de uma reserva.
 * Abrir o calendário público, a página do convite, a página da reunião ou o painel
 * (qualquer GET) só lê o banco.
 *
 * O link individual do Zoom (join_url) é credencial: nenhuma função daqui o devolve
 * para tela ou JSON, exceto entradaNaReuniao, que entrega o destino do
 * encaminhamento. Falha do Zoom nunca mexe na reserva.
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { enderecoPublico } from './enderecoPublico';
import { emitirPasse } from './entradaToken';
import { RECUSAS, ehCodigoDeConvite, linkDaReuniao, type RecusaDoConvite } from './publico';
import { ehUuid, type Resultado } from './reservas';
import { credenciaisDoZoom } from './zoomSala';
import { clienteZoom } from './zoomSalaServidor';
import { bancoDaInscricao, ehLinkDoZoom, garantirInscricao, type ChamarBanco, type ModoDoPedido, type ResultadoDaInscricao } from './zoomInscricao';
import {
  ESTADOS_DO_ACESSO,
  estadoPublico,
  janelaDoAcesso,
  limitesDoAcesso,
  type AcessoDaReserva,
  type AcessoPublico,
  type EstadoDoAcesso,
} from './zoomAcessoRegras';

type Env = Record<string, string | undefined>;

/** Função ou tabela ainda não existe: migration 007 pendente. */
const ESTRUTURA_FALTANDO = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);

class ErroDoBanco extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const chamarBanco: ChamarBanco = async (fn, args) => {
  const { data, error } = await createAdminSupabase().rpc(fn, args);
  if (error) throw new ErroDoBanco(error.code ?? '', error.message ?? '');
  return data;
};

const normalizarCodigo = (c: unknown) => (typeof c === 'string' ? c.trim().toLowerCase().slice(0, 40) : '');

/** Endereço da Legacy para entrar na reunião; null sem KICKOFF_PUBLIC_BASE_URL válida. */
export function enderecoDaReuniao(codigo: string, env: Env = process.env): string | null {
  const e = enderecoPublico(env);
  return e.ok ? linkDaReuniao(e.base, codigo) : null;
}

// ---------------------------------------------------------------------------
// Garantir a inscrição de uma reserva (fala com o Zoom)
// ---------------------------------------------------------------------------

export type ResultadoDoAcesso =
  | ResultadoDaInscricao
  | { estado: 'nao_configurada'; faltando: string[] }
  | { estado: 'estrutura_pendente' }
  | { estado: 'falha'; status: number; mensagem: string };

/**
 * usuarioId: quem pediu, quando é a equipe (o banco confere a permissão de kickoff);
 * null quando o pedido vem da própria empresa. Nunca lança.
 */
export async function garantirAcesso(reservaId: string, modo: ModoDoPedido, usuarioId: string | null, env: Env = process.env): Promise<ResultadoDoAcesso> {
  // Sem credenciais nem se reserva a inscrição no banco (ela ficaria "criando" à toa).
  const c = credenciaisDoZoom(env);
  if (!c.ok) return { estado: 'nao_configurada', faltando: c.faltando };
  try {
    return await garantirInscricao(reservaId, { zoom: clienteZoom(c.credenciais), banco: bancoDaInscricao(chamarBanco, usuarioId) }, modo);
  } catch (err) {
    if (err instanceof ErroDoBanco) {
      if (ESTRUTURA_FALTANDO.has(err.code)) return { estado: 'estrutura_pendente' };
      if (err.code === '42501') return { estado: 'falha', status: 403, mensagem: err.message || 'Sem permissão para gerar o acesso.' };
    }
    return { estado: 'falha', status: 500, mensagem: 'Não foi possível gerar o acesso ao Zoom agora.' };
  }
}

/** Espera o resultado até o prazo; depois disso responde "preparando" (o pedido continua no servidor). */
async function comPrazo(p: Promise<ResultadoDoAcesso>, prazoMs: number): Promise<ResultadoDoAcesso> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<ResultadoDoAcesso>((resolve) => {
    relogio = setTimeout(() => resolve({ estado: 'preparando' }), prazoMs);
  });
  try {
    return await Promise.race([p.catch((): ResultadoDoAcesso => ({ estado: 'preparando' })), prazo]);
  } finally {
    clearTimeout(relogio);
  }
}

// ---------------------------------------------------------------------------
// Estado do acesso (só o banco; nunca chama o Zoom; nunca leva o link)
// ---------------------------------------------------------------------------

type EstadoBruto = Omit<AcessoDaReserva, 'endereco'>;

function estadoBruto(v: unknown): (EstadoBruto & { reservaId: string }) | null {
  const b = v as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || !ehUuid(b.reserva_id) || !ESTADOS_DO_ACESSO.includes(b.estado as EstadoDoAcesso)) return null;
  const texto = (x: unknown, max: number) => (typeof x === 'string' && x ? x.slice(0, max) : null);
  return {
    reservaId: b.reserva_id,
    estado: b.estado as EstadoDoAcesso,
    erro: texto(b.erro, 300),
    nomeNoZoom: texto(b.nome_no_zoom, 200),
    nomeDifere: b.nome_difere === true,
    salaAnterior: b.sala_anterior === true,
    salaComProblemas: b.sala_com_problemas === true,
    atualizadoEm: texto(b.atualizado_em, 40),
  };
}

export interface AcessosDoPainel {
  /** Migration 007 aplicada? */
  estrutura: 'ok' | 'pendente';
  integracao: { configurada: boolean; faltando: string[] };
  /** null = nenhuma sala ativa. */
  sala: { verificacaoOk: boolean } | null;
  /** Só reservas ativas aparecem aqui. */
  acessos: Record<string, AcessoDaReserva>;
}

/** Estado do acesso das reservas ATIVAS informadas, com o endereço da Legacy de cada empresa. */
export async function acessosDoPainel(reservas: Array<{ id: string; tenantId: string; status: string }>, env: Env = process.env): Promise<AcessosDoPainel> {
  const c = credenciaisDoZoom(env);
  const integracao = { configurada: c.ok, faltando: c.ok ? [] : c.faltando };
  const pendente: AcessosDoPainel = { estrutura: 'pendente', integracao, sala: null, acessos: {} };
  const ativas = reservas.filter((r) => r.status === 'ativa');
  try {
    const admin = createAdminSupabase();
    const estrutura = await admin.from('agenda_kickoff_zoom_inscricoes').select('id').limit(1);
    if (estrutura.error) return pendente;
    const sala = await admin.from('agenda_kickoff_zoom_salas').select('verificacao_ok').eq('ativa', true).maybeSingle();
    const salaAtiva = sala.error || !sala.data ? null : { verificacaoOk: (sala.data as { verificacao_ok: boolean }).verificacao_ok === true };

    const acessos: Record<string, AcessoDaReserva> = {};
    if (ativas.length) {
      const brutos: Array<EstadoBruto & { reservaId: string }> = [];
      for (let i = 0; i < ativas.length; i += 200) {
        const { data, error } = await admin.rpc('agenda_kickoff_zoom_acessos', { p_reserva_ids: ativas.slice(i, i + 200).map((r) => r.id) });
        if (error) return pendente;
        for (const e of Array.isArray(data) ? data : []) {
          const b = estadoBruto(e);
          if (b) brutos.push(b);
        }
      }
      // Convite em vigor de cada empresa (mesmo expirado: com reserva, ele ainda leva à reunião).
      const codigos = new Map<string, string>();
      const tenants = [...new Set(ativas.map((r) => r.tenantId))];
      for (let i = 0; i < tenants.length; i += 200) {
        const { data } = await admin.from('agenda_kickoff_convites').select('codigo, tenant_id').is('revogado_em', null).in('tenant_id', tenants.slice(i, i + 200));
        for (const l of (data ?? []) as Array<{ codigo: string; tenant_id: string }>) codigos.set(l.tenant_id, l.codigo);
      }
      const tenantDe = new Map(ativas.map((r) => [r.id, r.tenantId]));
      for (const { reservaId, ...b } of brutos) {
        const codigo = codigos.get(tenantDe.get(reservaId) ?? '');
        acessos[reservaId] = { ...b, endereco: codigo ? enderecoDaReuniao(codigo, env) : null };
      }
    }
    return { estrutura: 'ok', integracao, sala: salaAtiva, acessos };
  } catch {
    return pendente;
  }
}

// ---------------------------------------------------------------------------
// Equipe: gerar ou recuperar o acesso de uma reserva (ação explícita)
// ---------------------------------------------------------------------------

export interface AcessoGerado {
  estado: 'pronto' | 'preparando' | 'erro' | 'conflito' | 'reserva_inativa' | 'sem_sala' | 'sala_com_problemas';
  /** Texto para a equipe. */
  mensagem: string;
  /** Endereço da Legacy para mandar à empresa; null se não deu para montar. */
  endereco: string | null;
  /** Por que não há endereço (falta o endereço oficial, convite recusado...). */
  avisoDoEndereco: string | null;
}

const MENSAGEM_PARA_A_EQUIPE: Record<Exclude<AcessoGerado['estado'], 'erro' | 'conflito'>, string> = {
  pronto: 'Acesso Zoom pronto.',
  preparando: 'Outro pedido está gerando este acesso agora. Atualize em instantes.',
  reserva_inativa: 'Só reserva ativa recebe acesso Zoom.',
  sem_sala: 'Não há sala Zoom ativa: ative a sala no quadro Sala Zoom.',
  sala_com_problemas: 'A sala Zoom ativa está com problemas na última verificação: confira o quadro Sala Zoom.',
};

/** Convite em vigor da empresa (cria um se não houver) -> endereço da reunião. */
async function enderecoDaEmpresa(usuarioId: string, reservaId: string, env: Env): Promise<{ endereco: string | null; aviso: string | null }> {
  const base = enderecoPublico(env);
  if (!base.ok) return { endereco: null, aviso: base.motivo };
  try {
    const admin = createAdminSupabase();
    const r = await admin.from('agenda_kickoff_reservas').select('tenant_id, status').eq('id', reservaId).maybeSingle();
    const reserva = r.data as { tenant_id: string; status: string } | null;
    if (r.error || !reserva || reserva.status !== 'ativa') return { endereco: null, aviso: null };
    const atual = await admin.from('agenda_kickoff_convites').select('codigo').eq('tenant_id', reserva.tenant_id).is('revogado_em', null).maybeSingle();
    let codigo = (atual.data as { codigo: string } | null)?.codigo ?? null;
    if (!codigo) {
      const novo = await admin.rpc('agenda_kickoff_convite_gerar', { p_tenant_id: reserva.tenant_id, p_validade_dias: null, p_usuario: usuarioId });
      if (novo.error) return { endereco: null, aviso: 'Não foi possível gerar o convite da empresa: gere em "Convites das empresas".' };
      codigo = (novo.data as { codigo?: string } | null)?.codigo ?? null;
    }
    return codigo && ehCodigoDeConvite(codigo) ? { endereco: linkDaReuniao(base.base, codigo), aviso: null } : { endereco: null, aviso: null };
  } catch {
    return { endereco: null, aviso: null };
  }
}

/**
 * A equipe pede o acesso de uma reserva: cria a inscrição que falta, tenta de novo a
 * que falhou e reavalia um conflito. Inscrição pronta não é refeita. Garante também o
 * convite da empresa, de onde sai o endereço da Legacy.
 */
export async function gerarAcessoDaReserva(usuarioId: string, reservaId: string, env: Env = process.env): Promise<Resultado<AcessoGerado>> {
  if (!ehUuid(reservaId)) return { ok: false, status: 404, message: 'Reserva não encontrada.' };
  const r = await garantirAcesso(reservaId, 'tentar_de_novo', usuarioId, env);
  if (r.estado === 'falha') return { ok: false, status: r.status, message: r.mensagem };
  if (r.estado === 'estrutura_pendente') return { ok: false, status: 503, message: 'O acesso Zoom ainda não foi instalado no banco (migration 007 pendente).' };
  if (r.estado === 'nao_configurada') return { ok: false, status: 409, message: `Integração Zoom não configurada no servidor: falta ${r.faltando.join(', ')}.` };
  const { endereco, aviso } = r.estado === 'reserva_inativa' ? { endereco: null, aviso: null } : await enderecoDaEmpresa(usuarioId, reservaId, env);
  const mensagem = r.estado === 'erro' || r.estado === 'conflito' ? r.mensagem : MENSAGEM_PARA_A_EQUIPE[r.estado];
  return { ok: true, dados: { estado: r.estado, mensagem, endereco, avisoDoEndereco: aviso } };
}

// ---------------------------------------------------------------------------
// Empresa: pelo código do convite (sem login)
// ---------------------------------------------------------------------------

type ReservaDoConvite =
  | { status: 'ok'; reservaId: string; inicio: string; fim: string; estado: EstadoDoAcesso; salaComProblemas: boolean }
  | { status: RecusaDoConvite | 'sem_reserva' | 'concluida' };

/** null = falha técnica ou migration 007 pendente. */
async function reservaDoConvite(codigo: string, origem: string, contar: boolean): Promise<ReservaDoConvite | null> {
  try {
    const { data, error } = await createAdminSupabase().rpc('agenda_kickoff_zoom_reserva_do_convite', { p_codigo: codigo, p_origem: origem, p_contar: contar });
    if (error) return null;
    const b = data as Record<string, unknown> | null;
    if (!b || typeof b !== 'object') return null;
    if (b.status === 'sem_reserva' || b.status === 'concluida' || RECUSAS.includes(b.status as RecusaDoConvite)) return { status: b.status as RecusaDoConvite };
    const e = estadoBruto(b.acesso);
    if (b.status !== 'ok' || !e || !ehUuid(b.reserva_id) || typeof b.inicio !== 'string' || typeof b.fim !== 'string') return null;
    return { status: 'ok', reservaId: b.reserva_id, inicio: b.inicio, fim: b.fim, estado: e.estado, salaComProblemas: e.salaComProblemas };
  } catch {
    return null;
  }
}

export type RespostaDoAcesso = { status: 'ok'; acesso: AcessoPublico } | { status: RecusaDoConvite | 'sem_reserva' | 'concluida' };

/**
 * Acesso à reunião da empresa do convite, para a página dela. Sem `tentar`, só lê o
 * banco. Com `tentar` (acabou de agendar, ou clicou em "Tentar de novo"), garante a
 * inscrição no Zoom, esperando no máximo `prazoMs`. A resposta nunca leva o link do
 * Zoom: só o estado e o endereço da Legacy. null = falha técnica (ou 007 pendente).
 */
export async function acessoDoConvite(
  codigoDaUrl: string,
  origem: string,
  opcoes: { tentar: boolean; prazoMs?: number },
  env: Env = process.env,
): Promise<RespostaDoAcesso | null> {
  const codigo = normalizarCodigo(codigoDaUrl);
  if (!ehCodigoDeConvite(codigo)) return { status: 'convite_invalido' };
  const r = await reservaDoConvite(codigo, origem, opcoes.tentar);
  if (!r) return null;
  if (r.status !== 'ok') return r;
  const limites = limitesDoAcesso(r.inicio, r.fim);
  if (!limites) return null;

  let estado = estadoPublico(r.estado, r.salaComProblemas);
  if (opcoes.tentar && r.estado !== 'pronto' && r.estado !== 'sem_sala') {
    const g = await comPrazo(garantirAcesso(r.reservaId, 'normal', null, env), opcoes.prazoMs ?? 8000);
    // Integração sem credenciais ou sem a estrutura: o cliente não tem o que tentar de novo.
    estado = g.estado === 'nao_configurada' || g.estado === 'estrutura_pendente' ? 'indisponivel' : g.estado === 'falha' ? 'preparando' : estadoPublico(g.estado);
  }
  return { status: 'ok', acesso: { estado, endereco: enderecoDaReuniao(codigo, env), ...limites } };
}

export type PreparoDaEntrada = { status: 'ok'; passe: string } | { status: 'fora_do_horario' | 'sem_reserva' | 'concluida' | RecusaDoConvite };

/**
 * Clique em "Entrar na reunião": confere (só no banco, sem Zoom) se a empresa do
 * convite pode entrar agora e, se puder, emite o passe de 2 minutos que o POST de
 * entrada exige (entradaToken.ts). null = falha técnica.
 */
export async function prepararEntrada(codigoDaUrl: string, origem: string, agora: number = Date.now(), env: Env = process.env): Promise<PreparoDaEntrada | null> {
  const codigo = normalizarCodigo(codigoDaUrl);
  if (!ehCodigoDeConvite(codigo)) return { status: 'convite_invalido' };
  const r = await reservaDoConvite(codigo, origem, false);
  if (!r) return null;
  if (r.status !== 'ok') return r;
  if (janelaDoAcesso(limitesDoAcesso(r.inicio, r.fim), agora) !== 'aberta') return { status: 'fora_do_horario' };
  try {
    return { status: 'ok', passe: emitirPasse(codigo, env, agora) };
  } catch {
    return null;
  }
}

export type EntradaNaReuniao =
  /** Encaminhar ao Zoom (url = link individual: só no cabeçalho Location). */
  | { tipo: 'zoom'; url: string }
  /** Voltar à página da reunião, que explica o estado (cedo demais, preparando, sem reserva...). */
  | { tipo: 'pagina'; codigo: string }
  | { tipo: 'recusa'; status: RecusaDoConvite };

/**
 * A operação de entrada (POST do botão "Entrar na reunião"), depois de conferidos a
 * origem do pedido e o passe. Confere TUDO de novo e só então entrega o link:
 * o convite vale (expirado com reserva ativa vale; revogado não), a empresa tem
 * reserva ATIVA, o momento está dentro da janela da SESSÃO DA RESERVA e a inscrição
 * da reserva está pronta na sala ativa (cria se faltar). A empresa e a reserva saem
 * do convite, no banco. null = falha técnica.
 */
export async function entradaNaReuniao(codigoDaUrl: string, origem: string, agora: number = Date.now(), env: Env = process.env): Promise<EntradaNaReuniao | null> {
  const codigo = normalizarCodigo(codigoDaUrl);
  if (!ehCodigoDeConvite(codigo)) return { tipo: 'recusa', status: 'convite_invalido' };
  const r = await reservaDoConvite(codigo, origem, true);
  if (!r) return null;
  if (r.status === 'sem_reserva' || r.status === 'concluida') return { tipo: 'pagina', codigo };
  if (r.status !== 'ok') return { tipo: 'recusa', status: r.status };
  if (janelaDoAcesso(limitesDoAcesso(r.inicio, r.fim), agora) !== 'aberta') return { tipo: 'pagina', codigo };

  const g = await comPrazo(garantirAcesso(r.reservaId, 'normal', null, env), 12_000);
  if (g.estado !== 'pronto' || !ehLinkDoZoom(g.joinUrl)) return { tipo: 'pagina', codigo };
  try {
    await createAdminSupabase().rpc('agenda_kickoff_zoom_inscricao_entregue', { p_id: g.inscricaoId });
  } catch {
    // Só a contagem de acessos: sem ela, o participante entra do mesmo jeito.
  }
  return { tipo: 'zoom', url: g.joinUrl };
}
