/**
 * Sala Zoom dos kickoffs (Zoom E1) no servidor. Só quem gerencia kickoffs chega
 * aqui (as rotas conferem com gestorDeKickoff). O Zoom é só LIDO (GET da reunião):
 * nada é criado nem alterado na conta Zoom. A gravação passa pelas funções da
 * migration 006, que conferem de novo a permissão, a trava de 2 horas e o Plan.
 *
 * Nada daqui vai para o navegador do cliente: Meeting ID, credenciais e token
 * ficam entre o servidor e a tela da equipe.
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createZoomClient, type ZoomClient, type ZoomCredentials } from '@/lib/zoom/api';
import type { Resultado } from './reservas';
import {
  aviso,
  avaliarSala,
  credenciaisDoZoom,
  explicarFalha,
  lerEntradaDaSala,
  problema,
  type Apontamento,
  type CodigoAviso,
  type CodigoProblema,
  type ResumoDaSala,
  type TipoDeFalha,
} from './zoomSala';

const falhou = (status: number, message: string) => ({ ok: false as const, status, message });

// ---------------------------------------------------------------------------
// Cliente Zoom único por processo (o token fica em memória e é reaproveitado)
// ---------------------------------------------------------------------------

let cliente: { chave: string; zoom: ZoomClient } | null = null;

export function clienteZoom(c: ZoomCredentials): ZoomClient {
  // Trocar as credenciais no ambiente descarta o cliente (e o token) antigo.
  const chave = `${c.accountId}\u0000${c.clientId}\u0000${c.clientSecret}`;
  if (!cliente || cliente.chave !== chave) {
    // fetch resolvido a cada chamada (os testes trocam o fetch global).
    cliente = { chave, zoom: createZoomClient(c, { fetchImpl: (...a) => fetch(...a) }) };
  }
  return cliente.zoom;
}

/** Só para testes: esquece o cliente e o token. */
export function _esquecerClienteZoom() {
  cliente = null;
}

// ---------------------------------------------------------------------------
// Verificar (consulta o Zoom; não grava nada)
// ---------------------------------------------------------------------------

export type Verificacao =
  | { status: 'entrada_invalida'; mensagem: string }
  | { status: 'nao_configurada'; faltando: string[] }
  | { status: 'erro'; tipo: TipoDeFalha; mensagem: string; temporaria: boolean; meetingId: string }
  | {
      status: 'verificada';
      meetingId: string;
      topico: string | null;
      ok: boolean;
      problemas: Apontamento<CodigoProblema>[];
      avisos: Apontamento<CodigoAviso>[];
      resumo: ResumoDaSala;
      verificadaEm: string;
    };

export async function verificarSala(entrada: unknown, env = process.env, agora = () => new Date()): Promise<Verificacao> {
  const e = lerEntradaDaSala(entrada);
  if (!e.ok) return { status: 'entrada_invalida', mensagem: e.mensagem };
  const c = credenciaisDoZoom(env);
  if (!c.ok) return { status: 'nao_configurada', faltando: c.faltando };

  let reuniao;
  try {
    reuniao = await clienteZoom(c.credenciais).getMeeting(e.meetingId);
  } catch (err) {
    return { status: 'erro', meetingId: e.meetingId, ...explicarFalha(err) };
  }
  const momento = agora();
  const a = avaliarSala(e.meetingId, reuniao, momento);

  // Sala de turma do Plan: a mesma regra que o banco aplica na ativação.
  try {
    const { data, error } = await createAdminSupabase().rpc('agenda_kickoff_zoom_sala_usada_no_plan', { p_zoom_meeting_id: e.meetingId });
    if (error) a.avisos.push(aviso('plan_nao_conferido'));
    else if (data === true) a.problemas.push(problema('sala_do_plan'));
  } catch {
    a.avisos.push(aviso('plan_nao_conferido'));
  }

  return {
    status: 'verificada',
    meetingId: e.meetingId,
    topico: a.topico,
    ok: a.problemas.length === 0,
    problemas: a.problemas,
    avisos: a.avisos,
    resumo: a.resumo,
    verificadaEm: momento.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Estado (só o banco; abrir a tela nunca chama o Zoom)
// ---------------------------------------------------------------------------

export interface SalaTela {
  id: string;
  meetingId: string;
  topico: string | null;
  ativa: boolean;
  verificacao: { ok: boolean; em: string; problemas: Array<{ codigo: string; titulo: string; orientacao: string }>; resumo: Partial<ResumoDaSala> };
  ativadaEm: string;
  desativadaEm: string | null;
  motivoDesativacao: string | null;
}

export interface HistoricoTela {
  id: number;
  meetingId: string | null;
  acao: 'ativada' | 'reativada' | 'desativada' | 'verificada';
  ok: boolean | null;
  problemas: string[];
  motivo: string | null;
  usuario: string | null;
  em: string;
}

export interface EstadoDaSalaZoom {
  integracao: { configurada: boolean; faltando: string[] };
  estrutura: 'ok' | 'pendente';
  ativa: SalaTela | null;
  anteriores: SalaTela[];
  historico: HistoricoTela[];
}

const TABELA_FALTANDO = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);

type LinhaSala = {
  id: string;
  zoom_meeting_id: string;
  topico: string | null;
  ativa: boolean;
  verificacao_ok: boolean;
  verificacao_problemas: unknown;
  verificacao_resumo: unknown;
  verificada_em: string;
  ativada_em: string;
  desativada_em: string | null;
  motivo_desativacao: string | null;
};

function problemasGuardados(v: unknown): Array<{ codigo: string; titulo: string; orientacao: string }> {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({ codigo: String(p.codigo ?? ''), titulo: String(p.titulo ?? ''), orientacao: String(p.orientacao ?? '') }));
}

function sala(l: LinhaSala): SalaTela {
  return {
    id: l.id,
    meetingId: l.zoom_meeting_id,
    topico: l.topico,
    ativa: l.ativa,
    verificacao: {
      ok: l.verificacao_ok,
      em: l.verificada_em,
      problemas: problemasGuardados(l.verificacao_problemas),
      resumo: l.verificacao_resumo && typeof l.verificacao_resumo === 'object' ? (l.verificacao_resumo as Partial<ResumoDaSala>) : {},
    },
    ativadaEm: l.ativada_em,
    desativadaEm: l.desativada_em,
    motivoDesativacao: l.motivo_desativacao,
  };
}

export async function estadoDaSala(env = process.env): Promise<EstadoDaSalaZoom> {
  const c = credenciaisDoZoom(env);
  const integracao = { configurada: c.ok, faltando: c.ok ? [] : c.faltando };
  const vazio: EstadoDaSalaZoom = { integracao, estrutura: 'pendente', ativa: null, anteriores: [], historico: [] };
  const admin = createAdminSupabase();

  const salas = await admin
    .from('agenda_kickoff_zoom_salas')
    .select('id, zoom_meeting_id, topico, ativa, verificacao_ok, verificacao_problemas, verificacao_resumo, verificada_em, ativada_em, desativada_em, motivo_desativacao')
    .order('ativada_em', { ascending: false })
    .limit(20);
  if (salas.error) {
    if (TABELA_FALTANDO.has(salas.error.code ?? '')) return vazio;
    throw new Error(salas.error.message);
  }
  const linhas = (salas.data ?? []) as LinhaSala[];
  const hist = await admin
    .from('agenda_kickoff_zoom_salas_historico')
    .select('id, sala_id, acao, verificacao_ok, problemas, motivo, usuario, em')
    .order('em', { ascending: false })
    .limit(30);
  if (hist.error) throw new Error(hist.error.message);
  const eventos = (hist.data ?? []) as Array<{
    id: number;
    sala_id: string;
    acao: HistoricoTela['acao'];
    verificacao_ok: boolean | null;
    problemas: unknown;
    motivo: string | null;
    usuario: string | null;
    em: string;
  }>;

  // Nomes de quem fez (equipe do Meet); só o nome vai para a tela.
  const ids = [...new Set(eventos.map((h) => h.usuario).filter((u): u is string => !!u))];
  const nomes = new Map<string, string>();
  if (ids.length) {
    const { data } = await admin.from('users').select('id, name').in('id', ids);
    for (const u of (data ?? []) as Array<{ id: string; name: string | null }>) nomes.set(u.id, u.name ?? '');
  }
  const meetingDe = new Map(linhas.map((l) => [l.id, l.zoom_meeting_id]));

  return {
    integracao,
    estrutura: 'ok',
    ativa: linhas.find((l) => l.ativa) ? sala(linhas.find((l) => l.ativa) as LinhaSala) : null,
    anteriores: linhas.filter((l) => !l.ativa).map(sala),
    historico: eventos.map((h) => ({
      id: h.id,
      meetingId: meetingDe.get(h.sala_id) ?? null,
      acao: h.acao,
      ok: h.verificacao_ok,
      problemas: problemasGuardados(h.problemas).map((p) => p.titulo),
      motivo: h.motivo,
      usuario: h.usuario ? nomes.get(h.usuario) || 'Equipe' : null,
      em: h.em,
    })),
  };
}

// ---------------------------------------------------------------------------
// Ativar e verificar de novo (gravam pelas funções da 006)
// ---------------------------------------------------------------------------

function erroDaSala(e: { code?: string | null; message?: string | null }): { ok: false; status: number; message: string } {
  const code = e.code ?? '';
  const message = e.message?.trim() || 'Falha ao gravar a sala Zoom.';
  if (TABELA_FALTANDO.has(code)) return falhou(503, 'A sala Zoom ainda não foi instalada no banco (migration 006 pendente).');
  if (code === '42501') return falhou(403, message);
  if (code === 'P0002') return falhou(404, message);
  if (code === '22023') return falhou(422, message);
  if (code === '23505') return falhou(409, 'Outra troca de sala acabou de acontecer. Recarregue a página.');
  return falhou(500, 'Falha ao gravar a sala Zoom.');
}

/** Verificação que não deu "verificada" -> resposta HTTP. */
function recusa(v: Exclude<Verificacao, { status: 'verificada' }>) {
  if (v.status === 'entrada_invalida') return falhou(400, v.mensagem);
  if (v.status === 'nao_configurada') return falhou(409, `Integração Zoom não configurada no servidor: falta ${v.faltando.join(', ')}.`);
  return falhou(v.temporaria ? 503 : 422, v.mensagem);
}

const guardar = (p: Apontamento<string>[]) => p.map(({ codigo, titulo, orientacao }) => ({ codigo, titulo, orientacao }));

export interface Ativacao {
  acao: 'ativada' | 'reativada' | 'verificada';
  anterior: string | null;
  verificacao: Extract<Verificacao, { status: 'verificada' }>;
}

/**
 * Verifica DE NOVO no Zoom e, se aprovada, ativa. Trocar a sala ativa por outra
 * exige motivo (o banco também exige). Sala com problema nunca é gravada.
 */
export async function ativarSala(usuarioId: string, entrada: unknown, motivo: unknown, env = process.env): Promise<Resultado<Ativacao>> {
  const v = await verificarSala(entrada, env);
  if (v.status !== 'verificada') return recusa(v);
  if (!v.ok) return falhou(422, `A sala não pode ser ativada: ${v.problemas.map((p) => p.titulo).join(' ')}`);
  const { data, error } = await createAdminSupabase().rpc('agenda_kickoff_zoom_sala_ativar', {
    p_zoom_meeting_id: v.meetingId,
    p_topico: v.topico,
    p_resumo: v.resumo,
    p_verificada_em: v.verificadaEm,
    p_motivo: typeof motivo === 'string' ? motivo.slice(0, 500) : null,
    p_usuario: usuarioId,
  });
  if (error) return erroDaSala(error);
  const d = (data ?? {}) as { acao?: Ativacao['acao']; anterior?: string | null };
  return { ok: true, dados: { acao: d.acao ?? 'ativada', anterior: d.anterior ?? null, verificacao: v } };
}

/**
 * Verifica a sala ativa e grava o resultado, aprovado ou não. Falha que não diz
 * nada sobre a sala (rede, limite, credenciais, permissão) não grava: a última
 * verificação continua valendo e a tela mostra o erro.
 */
export async function verificarSalaAtiva(usuarioId: string, env = process.env): Promise<Resultado<Verificacao>> {
  const admin = createAdminSupabase();
  const { data: atual, error } = await admin.from('agenda_kickoff_zoom_salas').select('id, zoom_meeting_id').eq('ativa', true).maybeSingle();
  if (error) return erroDaSala(error);
  if (!atual) return falhou(404, 'Nenhuma sala Zoom ativa.');
  const s = atual as { id: string; zoom_meeting_id: string };

  const v = await verificarSala(s.zoom_meeting_id, env);
  let ok: boolean;
  let problemas: Apontamento<string>[];
  let topico: string | null = null;
  let resumo: ResumoDaSala | null = null;
  let em = new Date().toISOString();
  if (v.status === 'verificada') {
    ok = v.ok;
    problemas = v.problemas;
    topico = v.topico;
    resumo = v.resumo;
    em = v.verificadaEm;
  } else if (v.status === 'erro' && v.tipo === 'nao_encontrada') {
    ok = false;
    problemas = [problema('nao_encontrada')];
  } else {
    return recusa(v as Exclude<Verificacao, { status: 'verificada' }>);
  }

  const r = await admin.rpc('agenda_kickoff_zoom_sala_registrar_verificacao', {
    p_sala_id: s.id,
    p_ok: ok,
    p_problemas: guardar(problemas),
    p_topico: topico,
    p_resumo: resumo,
    p_verificada_em: em,
    p_usuario: usuarioId,
  });
  if (r.error) return erroDaSala(r.error);
  return { ok: true, dados: v };
}
