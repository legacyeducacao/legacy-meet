/**
 * Regras da sala Zoom dos kickoffs (Zoom E1). Funções puras: sem rede, sem banco,
 * sem process.env (o ambiente entra como parâmetro). Adaptado do Legacy CS
 * (src/lib/kickoffs-zoom.ts) e das regras do Legacy Plan (checkMeetingConfig).
 *
 * Modelo: UMA reunião recorrente do Zoom, com horário fixo, serve todas as sessões
 * de kickoff. Cada empresa (E2) se inscreve uma vez nessa reunião e recebe um link
 * individual que vale para qualquer ocorrência. Por isso a sala precisa de:
 *   - tipo 8 (recorrente com horário fixo);
 *   - inscrição obrigatória com aprovação automática (approval_type 0);
 *   - "inscrever-se uma vez para todas as ocorrências" (registration_type 1),
 *     que é o que permite reaproveitar a inscrição entre sessões;
 *   - sem exigir login no Zoom (meeting_authentication), senão o cliente não entra.
 */
import { ZoomApiError, type ZoomCredentials, type ZoomMeeting } from '@/lib/zoom/api';

// ---------------------------------------------------------------------------
// Credenciais (só nomes; os valores nunca saem do servidor)
// ---------------------------------------------------------------------------

export const VARIAVEIS_DO_ZOOM = ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'] as const;

export function credenciaisDoZoom(
  env: Record<string, string | undefined> = process.env,
): { ok: true; credenciais: ZoomCredentials } | { ok: false; faltando: string[] } {
  const v = (n: string) => (env[n] ?? '').trim();
  const faltando = VARIAVEIS_DO_ZOOM.filter((n) => !v(n));
  if (faltando.length) return { ok: false, faltando };
  return { ok: true, credenciais: { accountId: v('ZOOM_ACCOUNT_ID'), clientId: v('ZOOM_CLIENT_ID'), clientSecret: v('ZOOM_CLIENT_SECRET') } };
}

// ---------------------------------------------------------------------------
// Entrada: link ou Meeting ID
// ---------------------------------------------------------------------------

/**
 * Reunião de teste de uma turma antiga do Plan, usada no desenvolvimento do CS
 * (guia do CS, seção 6.3). Nunca pode ser a sala do Impulsão. O banco também
 * recusa qualquer sala de turma do Plan (agenda_kickoff_zoom_sala_usada_no_plan).
 */
export const SALAS_DE_TESTE = ['88672328525'];

const LINK_DE_ENTRADA = /^https?:\/\/([a-z0-9-]+\.)*zoom\.us\/(?:j|w|s|wc\/join)\/(\d{9,12})(?:[/?#]|$)/i;

export function lerEntradaDaSala(texto: unknown): { ok: true; meetingId: string } | { ok: false; mensagem: string } {
  const t = typeof texto === 'string' ? texto.trim() : '';
  if (!t) return { ok: false, mensagem: 'Informe o Meeting ID ou o link da reunião do Zoom.' };
  if (/zoom\.us\/meeting\/register\//i.test(t)) {
    return {
      ok: false,
      mensagem: 'Esse é o link de inscrição, que não traz o Meeting ID. Copie o ID (ou o link de entrada /j/...) na página da reunião no Zoom.',
    };
  }
  const link = LINK_DE_ENTRADA.exec(t);
  if (link) return { ok: true, meetingId: link[2] };
  if (/^[\d\s.-]+$/.test(t)) {
    const digitos = t.replace(/\D/g, '');
    if (/^\d{9,12}$/.test(digitos)) return { ok: true, meetingId: digitos };
  }
  return { ok: false, mensagem: 'Meeting ID inválido: são 9 a 12 dígitos (ex.: 812 3456 7890) ou o link de entrada da reunião.' };
}

// ---------------------------------------------------------------------------
// Avaliação da reunião
// ---------------------------------------------------------------------------

export type CodigoProblema =
  | 'reuniao_instantanea'
  | 'reuniao_unica'
  | 'sem_horario_fixo'
  | 'tipo_desconhecido'
  | 'inscricao_desligada'
  | 'aprovacao_manual'
  | 'inscricao_por_ocorrencia'
  | 'autenticacao_obrigatoria'
  | 'sala_de_teste'
  | 'sala_do_plan'
  | 'nao_encontrada';

export type CodigoAviso = 'sem_ocorrencias_futuras' | 'ultima_ocorrencia_proxima' | 'sala_de_espera' | 'entrada_antes_do_anfitriao' | 'plan_nao_conferido';

export interface Apontamento<C extends string> {
  codigo: C;
  titulo: string;
  orientacao: string;
}

const PROBLEMAS: Record<CodigoProblema, Omit<Apontamento<CodigoProblema>, 'codigo'>> = {
  reuniao_instantanea: {
    titulo: 'É uma reunião instantânea.',
    orientacao: 'Crie uma reunião agendada recorrente, com horário fixo, e informe o ID dela.',
  },
  reuniao_unica: {
    titulo: 'A reunião não é recorrente.',
    orientacao: 'No Zoom, marque "Reunião recorrente" com recorrência diária, semanal ou mensal (horário fixo).',
  },
  sem_horario_fixo: {
    titulo: 'A reunião é recorrente "sem horário fixo".',
    orientacao: 'Esse tipo não aceita inscrição. Crie a sala com recorrência diária, semanal ou mensal.',
  },
  tipo_desconhecido: {
    titulo: 'Tipo de reunião não reconhecido.',
    orientacao: 'Use uma reunião agendada recorrente, com horário fixo.',
  },
  inscricao_desligada: {
    titulo: 'A inscrição não está obrigatória.',
    orientacao: 'No Zoom, ative "Inscrição: obrigatória" na reunião.',
  },
  aprovacao_manual: {
    titulo: 'A inscrição está com aprovação manual.',
    orientacao: 'Em Inscrição → Aprovação, escolha "Aprovar automaticamente". Com aprovação manual, a empresa ficaria pendente e sem link.',
  },
  inscricao_por_ocorrencia: {
    titulo: 'A inscrição é por ocorrência.',
    orientacao: 'Escolha "Os participantes se inscrevem uma vez e podem participar de qualquer ocorrência". É o que permite a mesma inscrição valer em qualquer sessão.',
  },
  autenticacao_obrigatoria: {
    titulo: 'A reunião exige login no Zoom.',
    orientacao: 'Desative "Exigir autenticação para entrar". Os clientes entram pelo link individual, sem conta Zoom da Legacy.',
  },
  sala_de_teste: {
    titulo: 'Esta é a reunião de teste usada no desenvolvimento do Legacy CS.',
    orientacao: 'Ela pertence a uma turma antiga do Plan e não serve para a operação. Crie uma sala exclusiva do Impulsão.',
  },
  nao_encontrada: {
    titulo: 'A reunião não foi encontrada na conta Zoom da integração.',
    orientacao: 'Ela pode ter sido apagada ou movida para outra conta. Confira no Zoom ou ative outra sala.',
  },
  sala_do_plan: {
    titulo: 'Esta reunião é usada por uma turma do Legacy Plan.',
    orientacao: 'A sala do Impulsão precisa ser exclusiva: a coleta de presença do Plan passaria a vigiar os kickoffs. Crie uma reunião nova.',
  },
};

const AVISOS: Record<CodigoAviso, Omit<Apontamento<CodigoAviso>, 'codigo'>> = {
  sem_ocorrencias_futuras: {
    titulo: 'A reunião não tem ocorrências futuras.',
    orientacao: 'Estenda a recorrência no Zoom (até 50 ocorrências) antes das próximas sessões.',
  },
  ultima_ocorrencia_proxima: {
    titulo: 'A última ocorrência está a 30 dias ou menos.',
    orientacao: 'Estenda a recorrência no Zoom ou prepare a troca de sala. O comportamento depois da última ocorrência ainda não foi testado.',
  },
  sala_de_espera: {
    titulo: 'A sala de espera está ligada.',
    orientacao: 'Cada participante terá de ser admitido pelo anfitrião. Recomendado: desligar.',
  },
  entrada_antes_do_anfitriao: {
    titulo: 'Os participantes podem entrar antes do anfitrião.',
    orientacao: 'Recomendado: desligar, para que a sessão só comece com quem conduz.',
  },
  plan_nao_conferido: {
    titulo: 'Não deu para conferir se a reunião é de uma turma do Plan.',
    orientacao: 'O banco confere de novo na ativação e recusa sala de turma do Plan.',
  },
};

export const problema = (codigo: CodigoProblema): Apontamento<CodigoProblema> => ({ codigo, ...PROBLEMAS[codigo] });
export const aviso = (codigo: CodigoAviso): Apontamento<CodigoAviso> => ({ codigo, ...AVISOS[codigo] });

/**
 * O que se guarda da reunião: LISTA FECHADA. Nunca start_url, join_url, senha,
 * e-mail do anfitrião ou link de inscrição.
 */
export interface ResumoDaSala {
  tipo: number | null;
  recorrencia: { tipo: number | null; intervalo: number | null; fimEm: string | null; fimApos: number | null } | null;
  aprovacao: number | null;
  inscricao: number | null;
  fuso: string | null;
  duracaoMin: number | null;
  ocorrenciasFuturas: number;
  proxima: string | null;
  ultima: string | null;
  salaDeEspera: boolean | null;
  autenticacao: boolean | null;
  entradaAntesDoAnfitriao: boolean | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
const str = (v: unknown, max = 60) => (typeof v === 'string' && v ? v.slice(0, max) : null);

export function resumoDaSala(m: ZoomMeeting, agora: Date): ResumoDaSala {
  const futuras = (m.occurrences ?? [])
    .filter((o) => o.status !== 'deleted' && typeof o.start_time === 'string' && Date.parse(o.start_time) > agora.getTime())
    .map((o) => new Date(Date.parse(o.start_time as string)).toISOString())
    .sort();
  const r = m.recurrence;
  return {
    tipo: num(m.type),
    recorrencia: r ? { tipo: num(r.type), intervalo: num(r.repeat_interval), fimEm: str(r.end_date_time, 40), fimApos: num(r.end_times) } : null,
    aprovacao: num(m.settings?.approval_type),
    inscricao: num(m.settings?.registration_type),
    fuso: str(m.timezone),
    duracaoMin: num(m.duration),
    ocorrenciasFuturas: futuras.length,
    proxima: futuras[0] ?? null,
    ultima: futuras[futuras.length - 1] ?? null,
    salaDeEspera: bool(m.settings?.waiting_room),
    autenticacao: bool(m.settings?.meeting_authentication),
    entradaAntesDoAnfitriao: bool(m.settings?.join_before_host),
  };
}

export interface AvaliacaoDaSala {
  ok: boolean;
  topico: string | null;
  problemas: Apontamento<CodigoProblema>[];
  avisos: Apontamento<CodigoAviso>[];
  resumo: ResumoDaSala;
}

/** Regras do Plan (inscrição) + exigências da sala única do kickoff. */
export function avaliarSala(meetingId: string, m: ZoomMeeting, agora: Date): AvaliacaoDaSala {
  const resumo = resumoDaSala(m, agora);
  const problemas: Apontamento<CodigoProblema>[] = [];
  if (SALAS_DE_TESTE.includes(meetingId)) problemas.push(problema('sala_de_teste'));
  if (m.type === 1) problemas.push(problema('reuniao_instantanea'));
  else if (m.type === 2) problemas.push(problema('reuniao_unica'));
  else if (m.type === 3) problemas.push(problema('sem_horario_fixo'));
  else if (m.type !== 8) problemas.push(problema('tipo_desconhecido'));
  const aprovacao = m.settings?.approval_type;
  if (aprovacao === 2 || aprovacao === undefined || aprovacao === null) problemas.push(problema('inscricao_desligada'));
  else if (aprovacao === 1) problemas.push(problema('aprovacao_manual'));
  else if (aprovacao !== 0) problemas.push(problema('inscricao_desligada'));
  const inscricao = m.settings?.registration_type;
  // Regra do Plan: em recorrente, sem o campo conta como "uma vez para todas".
  if ((m.type === 3 || m.type === 8) && inscricao !== undefined && inscricao !== null && inscricao !== 1) problemas.push(problema('inscricao_por_ocorrencia'));
  if (m.settings?.meeting_authentication === true) problemas.push(problema('autenticacao_obrigatoria'));

  const avisos: Apontamento<CodigoAviso>[] = [];
  if (m.type === 8) {
    if (resumo.ocorrenciasFuturas === 0) avisos.push(aviso('sem_ocorrencias_futuras'));
    else if (resumo.ultima && Date.parse(resumo.ultima) - agora.getTime() <= 30 * 86_400_000) avisos.push(aviso('ultima_ocorrencia_proxima'));
  }
  if (m.settings?.waiting_room === true) avisos.push(aviso('sala_de_espera'));
  if (m.settings?.join_before_host === true) avisos.push(aviso('entrada_antes_do_anfitriao'));

  return { ok: problemas.length === 0, topico: str(m.topic, 300), problemas, avisos, resumo };
}

// ---------------------------------------------------------------------------
// Falhas do Zoom -> mensagem para a equipe (nunca texto do Zoom, token ou segredo)
// ---------------------------------------------------------------------------

export type TipoDeFalha = 'nao_encontrada' | 'credenciais' | 'sem_permissao' | 'limite' | 'indisponivel' | 'outra';

export interface FalhaDoZoom {
  tipo: TipoDeFalha;
  mensagem: string;
  /** Falha passageira: tentar de novo pode resolver; não muda o estado gravado. */
  temporaria: boolean;
}

export function explicarFalha(err: unknown): FalhaDoZoom {
  if (!(err instanceof ZoomApiError)) return { tipo: 'outra', mensagem: 'Não foi possível consultar o Zoom agora. Tente de novo.', temporaria: true };
  if (err.status === 0) return { tipo: 'indisponivel', mensagem: 'O Zoom não respondeu. Tente de novo em instantes.', temporaria: true };
  if (err.status === 429) {
    const espera = err.esperarSegundos ? ` em ${err.esperarSegundos} s` : ' em alguns segundos';
    return { tipo: 'limite', mensagem: `O Zoom limitou as chamadas da conta agora. Tente de novo${espera}.`, temporaria: true };
  }
  if (err.status >= 500) return { tipo: 'indisponivel', mensagem: `O Zoom está com instabilidade (HTTP ${err.status}). Tente de novo em instantes.`, temporaria: true };
  if (err.origem === 'oauth') {
    return {
      tipo: 'credenciais',
      mensagem: 'O Zoom recusou as credenciais do servidor (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET). Confira os valores e se o app Server-to-Server está ativado.',
      temporaria: false,
    };
  }
  // 3001: reunião não existe (ou não é desta conta: a API só devolve reuniões da conta do app).
  if (err.status === 404 || err.code === 3001) {
    return {
      tipo: 'nao_encontrada',
      mensagem: 'Reunião não encontrada na conta Zoom da integração. Confira o ID e se a reunião foi criada por um usuário desta conta.',
      temporaria: false,
    };
  }
  if (err.status === 401 || err.status === 403) {
    return {
      tipo: 'sem_permissao',
      mensagem: 'O app do Zoom não tem permissão para ler esta reunião (escopo meeting:read:meeting:admin) ou a reunião é de outra conta.',
      temporaria: false,
    };
  }
  return { tipo: 'outra', mensagem: `O Zoom recusou a consulta (código ${err.code ?? err.status}).`, temporaria: false };
}
