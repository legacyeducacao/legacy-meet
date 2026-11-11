/**
 * Integração Legacy Meet -> ExecScore.
 *
 * Fluxo:
 *  1. O executor encerra a reunião e, na tela de saída (/obrigado), marca os
 *     pilares que NÃO foram tratados (savePillarChoice).
 *  2. O worker termina a transcrição e avisa o app (registerTranscriptReady).
 *  3. Quando as duas coisas existem, a transcrição vai para a edge function do
 *     ExecScore, que avalia e grava no painel do executor responsável
 *     (meetings.host_id -> execscore.executors.user_id).
 *
 * Se o executor fechar a aba sem escolher, depois de EXECSCORE_PILLAR_WAIT_HOURS
 * a reunião é avaliada com todos os pilares (o varredor cuida disso).
 * Uma reunião gera uma única avaliação; reprocessos atualizam a mesma.
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getManifest, getObjectText, type RecordingManifest } from '@/lib/recordings';
import { chunkArray } from '@/lib/chunk';

export const PILARES = [
  { key: 'score_estrategia', label: 'Estratégia & BSC' },
  { key: 'score_financeiro', label: 'Gestão Financeira' },
  { key: 'score_execucao', label: 'Execução & Postura' },
  { key: 'score_processos', label: 'Processos & Escala' },
  { key: 'score_marketing', label: 'Comercial & Marketing' },
  { key: 'score_lideranca', label: 'Liderança & Mindset' },
] as const;

export type PilarKey = (typeof PILARES)[number]['key'];
const PILAR_KEYS = PILARES.map((p) => p.key) as readonly string[];

const MAX_TENTATIVAS = Number(process.env.EXECSCORE_MAX_ATTEMPTS ?? '4');
const ESPERA_HORAS = Number(process.env.EXECSCORE_PILLAR_WAIT_HOURS ?? '24');
const FUNCTION_TIMEOUT_MS = Number(process.env.EXECSCORE_FUNCTION_TIMEOUT_MS ?? '300000');

/** O envio deu erro e o varredor já desistiu (só volta se alguém reenviar). */
export function tentativasEsgotadas(row: { status: string; tentativas: number } | null): boolean {
  return !!row && row.status === 'erro' && row.tentativas >= MAX_TENTATIVAS;
}

export function isEnabled(): boolean {
  return !!process.env.EXECSCORE_INTERNAL_SECRET;
}

function esperaInterval(): string {
  const h = Number.isFinite(ESPERA_HORAS) && ESPERA_HORAS >= 0 ? ESPERA_HORAS : 24;
  return `${h} hours`;
}

function functionUrl(): string {
  return (
    process.env.EXECSCORE_FUNCTION_URL ??
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/execscore-evaluate-executor`
  );
}

// ----------------------------- Regras puras -----------------------------

/** Valida a lista de pilares desligados. Lança se sobrar nenhum ativo. */
export function sanitizeDisabled(input: unknown): PilarKey[] {
  if (!Array.isArray(input)) throw new Error('pilares_desabilitados deve ser uma lista');
  const out = [...new Set(input.filter((k): k is PilarKey => typeof k === 'string' && PILAR_KEYS.includes(k)))];
  if (out.length >= PILARES.length) throw new Error('Mantenha pelo menos um pilar ativo');
  return out;
}

export function activePillars(disabled: readonly string[] | null | undefined): PilarKey[] {
  const off = new Set(disabled ?? []);
  return PILARES.map((p) => p.key).filter((k) => !off.has(k));
}

/** "<sala>__<timestamp>" -> "<sala>" (mesmo formato do /api/record/start). */
export function roomFromRecordingId(id: string): string | null {
  const i = id.indexOf('__');
  if (i <= 0) return null;
  const room = id.slice(0, i);
  return /^[\w-]+$/.test(room) ? room : null;
}

/**
 * Junta as partes da reunião (gravação reiniciada gera mais de um arquivo) em
 * ordem cronológica. Com uma parte só, devolve o texto como está.
 */
export function joinTranscriptParts(parts: Array<{ createdAt: string; text: string }>): string {
  const sorted = [...parts]
    .filter((p) => p.text.trim())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (sorted.length <= 1) return sorted[0]?.text.trim() ?? '';
  return sorted
    .map((p, i) => `=== Parte ${i + 1} de ${sorted.length} da reunião ===\n${p.text.trim()}`)
    .join('\n\n');
}

// ----------------------------- Banco -----------------------------

type Integracao = {
  meeting_id: string;
  executor_id: string;
  pilares_desabilitados: string[] | null;
  pilares_escolhidos_em: string | null;
  recording_ids: string[];
  status: 'aguardando' | 'processando' | 'enviada' | 'erro' | 'descartada';
  evaluation_id: string | null;
  tentativas: number;
  ultimo_erro: string | null;
};

export type ExecutoriaMeeting = {
  meetingId: string;
  roomName: string;
  title: string | null;
  hostId: string;
  hostName: string | null;
  clientName: string | null;
  startedAt: string | null;
  scheduledStartAt: string | null;
  executorId: string;
  executorName: string;
  /** Marcada como onboarding na criação/edição: não vai para o ExecScore. */
  onboarding: boolean;
  /** Cliente não compareceu (status no_show): não vai para o ExecScore. */
  noShow: boolean;
  /** Encontro em grupo do Impulsão (aula, não consultoria 1 a 1). */
  grupo?: boolean;
};

/** Por que a reunião não vai para o ExecScore (null = vai). */
export function motivoForaDoScore(m: Pick<ExecutoriaMeeting, 'onboarding' | 'noShow' | 'grupo'>): string | null {
  if (m.noShow) return 'no-show: o cliente não compareceu';
  if (m.onboarding) return 'reunião de onboarding';
  if (m.grupo && process.env.EXECSCORE_AVALIAR_GRUPOS !== '1') return 'encontro em grupo do Impulsão';
  return null;
}

function pick<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * Reunião da Executoria cujo anfitrião é um executor cadastrado no ExecScore.
 * Qualquer outra (comercial, sem anfitrião, anfitrião fora do ExecScore) volta null.
 */
export async function findExecutoriaMeeting(
  by: { roomName: string } | { meetingId: string },
): Promise<ExecutoriaMeeting | null> {
  const admin = createAdminSupabase();
  let q = admin
    .from('meetings')
    .select(
      'id, room_name, title, host_id, status, started_at, scheduled_start_at, users:host_id(name), client_tenants:tenant_id(name), meet_meeting_sector(sector, onboarding)',
    );
  q = 'roomName' in by ? q.eq('room_name', by.roomName) : q.eq('id', by.meetingId);
  const { data: m, error } = await q.maybeSingle();
  if (error) throw new Error(`meeting: ${error.message}`);
  if (!m?.host_id) return null;
  type Sec = { sector?: string; onboarding?: boolean };
  const sec = pick(m.meet_meeting_sector as Sec | Sec[] | null);
  if (sec?.sector !== 'executoria') return null;

  const { data: ex, error: exErr } = await admin
    .schema('execscore')
    .from('executors')
    .select('id, name')
    .eq('user_id', m.host_id)
    .maybeSingle();
  if (exErr) throw new Error(`executor: ${exErr.message}`);
  if (!ex) return null;

  // Reunião gerada por um grupo do Impulsão (agenda nova)?
  const { data: oc } = await admin
    .from('agenda_ocorrencias')
    .select('agenda_series(grupo_id)')
    .eq('meeting_id', m.id)
    .maybeSingle();
  const serieOc = pick((oc as { agenda_series?: { grupo_id: string | null } | { grupo_id: string | null }[] | null } | null)?.agenda_series ?? null);

  return {
    meetingId: m.id,
    roomName: m.room_name,
    title: m.title?.trim() || null,
    hostId: m.host_id,
    hostName: pick(m.users as { name?: string | null } | null)?.name ?? null,
    clientName: pick(m.client_tenants as { name?: string | null } | null)?.name?.trim() || null,
    startedAt: m.started_at,
    scheduledStartAt: m.scheduled_start_at,
    executorId: ex.id,
    executorName: ex.name,
    onboarding: sec.onboarding === true,
    noShow: m.status === 'no_show',
    grupo: !!serieOc?.grupo_id,
  };
}

/**
 * Tira a reunião da fila do ExecScore (onboarding ou no-show). Avaliação já
 * enviada fica como está: apagar nota no ExecScore é decisão do admin de lá.
 */
export async function descartarEnvio(meetingId: string, motivo: string): Promise<void> {
  const { error } = await createAdminSupabase()
    .schema('execscore')
    .from('meet_integracao')
    .update({ status: 'descartada', ultimo_erro: motivo, processando_desde: null })
    .eq('meeting_id', meetingId)
    .in('status', ['aguardando', 'erro', 'processando']);
  if (error) throw new Error(`descartar envio: ${error.message}`);
}

/** Volta para a fila uma reunião descartada (no-show desfeito, onboarding desligado). */
export async function reabrirEnvio(meetingId: string): Promise<void> {
  const { error } = await createAdminSupabase()
    .schema('execscore')
    .from('meet_integracao')
    .update({ status: 'aguardando', tentativas: 0, ultimo_erro: null })
    .eq('meeting_id', meetingId)
    .eq('status', 'descartada');
  if (error) throw new Error(`reabrir envio: ${error.message}`);
}

/**
 * Onboarding ou no-show mudou: tira da fila ou devolve e tenta enviar. Nunca
 * lança (quem chama já salvou a mudança principal; aqui é só a integração).
 */
export async function syncForaDoScore(meetingId: string): Promise<void> {
  if (!isEnabled()) return;
  try {
    const meeting = await findExecutoriaMeeting({ meetingId });
    if (!meeting) return;
    const motivo = motivoForaDoScore(meeting);
    if (motivo) await descartarEnvio(meetingId, motivo);
    else {
      await reabrirEnvio(meetingId);
      await dispatchMeeting(meetingId);
    }
  } catch (e) {
    console.error(`execscore: sync onboarding/no-show ${meetingId}`, e);
  }
}

/** Situação do envio ao ExecScore de várias reuniões (lista de gravações). */
export async function statusDasReunioes(meetingIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!isEnabled() || !meetingIds.length) return out;
  const admin = createAdminSupabase();
  const lotes = await Promise.all(
    chunkArray([...new Set(meetingIds)], 100).map((ids) =>
      admin.schema('execscore').from('meet_integracao').select('meeting_id, status').in('meeting_id', ids),
    ),
  );
  for (const r of lotes) {
    if (r.error) console.error('execscore: status das reuniões', r.error);
    for (const row of (r.data ?? []) as Array<{ meeting_id: string; status: string }>) out.set(row.meeting_id, row.status);
  }
  return out;
}

export type ResumoErros = {
  /** Reuniões que não chegaram ao ExecScore (status erro). */
  total: number;
  /** Quantas pararam por falta de créditos no ExecScore (resposta 402). */
  semCreditos: number;
  ultimoErro: string | null;
  desde: string | null;
};

const SEM_CREDITOS = /402|cr[ée]dito/i;

/** Aviso dos admins: envios com erro (falta de créditos aparece separada). */
export async function resumoErros(): Promise<ResumoErros> {
  const vazio: ResumoErros = { total: 0, semCreditos: 0, ultimoErro: null, desde: null };
  if (!isEnabled()) return vazio;
  const { data, error } = await createAdminSupabase()
    .schema('execscore')
    .from('meet_integracao')
    .select('ultimo_erro, updated_at')
    .eq('status', 'erro')
    .order('updated_at', { ascending: true })
    .limit(500);
  if (error) throw new Error(`resumo de erros: ${error.message}`);
  const linhas = (data ?? []) as Array<{ ultimo_erro: string | null; updated_at: string }>;
  if (!linhas.length) return vazio;
  return {
    total: linhas.length,
    semCreditos: linhas.filter((l) => SEM_CREDITOS.test(l.ultimo_erro ?? '')).length,
    ultimoErro: linhas[linhas.length - 1].ultimo_erro,
    desde: linhas[0].updated_at,
  };
}

/**
 * Admin pediu para reenviar tudo que deu erro (ex.: depois de recarregar os
 * créditos): volta para a fila com as tentativas zeradas e devolve os ids
 * (quem chama dispara o envio em segundo plano; o varredor também pega).
 */
export async function reabrirErros(): Promise<string[]> {
  const { data, error } = await createAdminSupabase()
    .schema('execscore')
    .from('meet_integracao')
    .update({ status: 'aguardando', tentativas: 0 })
    .eq('status', 'erro')
    .select('meeting_id');
  if (error) throw new Error(`reabrir erros: ${error.message}`);
  return ((data ?? []) as Array<{ meeting_id: string }>).map((r) => r.meeting_id);
}

export async function getIntegracao(meetingId: string): Promise<Integracao | null> {
  const { data, error } = await createAdminSupabase()
    .schema('execscore')
    .from('meet_integracao')
    .select('*')
    .eq('meeting_id', meetingId)
    .maybeSingle();
  if (error) throw new Error(`meet_integracao: ${error.message}`);
  return (data as Integracao | null) ?? null;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await createAdminSupabase().schema('execscore').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  // Funções "returns <tipo da tabela>" sem linha devolvem um objeto de nulos.
  const row = pick(data as T | T[] | null) as (T & { meeting_id?: string | null }) | null;
  return row && row.meeting_id ? row : null;
}

/** Worker avisou que a transcrição de uma gravação terminou. */
export async function registerTranscriptReady(
  recordingId: string,
): Promise<{ status: 'registrada' | 'ignorada'; motivo?: string; meetingId?: string }> {
  const room = roomFromRecordingId(recordingId);
  if (!room) return { status: 'ignorada', motivo: 'id de gravação inválido' };

  const manifest = await getManifest(recordingId);
  if (!manifest) return { status: 'ignorada', motivo: 'manifesto não encontrado' };
  if (manifest.transcriptionStatus !== 'complete') {
    return { status: 'ignorada', motivo: `transcrição ${manifest.transcriptionStatus}` };
  }

  const meeting = await findExecutoriaMeeting({ roomName: room });
  if (!meeting) return { status: 'ignorada', motivo: 'não é reunião de executor do ExecScore' };
  const fora = motivoForaDoScore(meeting);
  if (fora) {
    await descartarEnvio(meeting.meetingId, fora);
    return { status: 'ignorada', motivo: fora };
  }

  await rpc('meet_registrar_transcricao', {
    p_meeting_id: meeting.meetingId,
    p_executor_id: meeting.executorId,
    p_recording_id: recordingId,
  });
  return { status: 'registrada', meetingId: meeting.meetingId };
}

/** Executor escolheu os pilares desligados na saída da reunião. */
export async function savePillarChoice(
  meeting: ExecutoriaMeeting,
  disabled: PilarKey[],
  userId: string,
): Promise<void> {
  await rpc('meet_registrar_pilares', {
    p_meeting_id: meeting.meetingId,
    p_executor_id: meeting.executorId,
    p_desabilitados: disabled,
    p_user_id: userId,
  });
}

async function loadTranscript(recordingIds: string[]): Promise<{ text: string; used: string[] }> {
  const parts: Array<{ createdAt: string; text: string; id: string }> = [];
  for (const id of recordingIds) {
    const m: RecordingManifest | null = await getManifest(id);
    if (!m || m.transcriptionStatus !== 'complete') continue;
    const text = (m.transcriptTxtKey ? await getObjectText(m.transcriptTxtKey) : null) ?? '';
    if (text.trim()) parts.push({ createdAt: m.createdAt, text, id });
  }
  return { text: joinTranscriptParts(parts), used: parts.map((p) => p.id) };
}

/**
 * Tenta enviar a reunião ao ExecScore. Não faz nada se ela ainda não estiver
 * pronta (sem transcrição, ou sem pilares e dentro do prazo de espera) ou se
 * outro envio já estiver em andamento. Seguro chamar quantas vezes quiser.
 */
export async function dispatchMeeting(meetingId: string): Promise<'enviada' | 'nao_pronta' | 'erro'> {
  const claimed = await rpc<Integracao>('meet_reivindicar_envio', {
    p_meeting_id: meetingId,
    p_espera: esperaInterval(),
    p_max_tentativas: MAX_TENTATIVAS,
  });
  if (!claimed) return 'nao_pronta';

  const conclude = (ok: boolean, evaluationId: string | null, erro: string | null) =>
    rpc('meet_concluir_envio', {
      p_meeting_id: meetingId,
      p_ok: ok,
      p_evaluation_id: evaluationId,
      p_erro: erro,
      p_recording_ids: claimed.recording_ids,
      p_pilares_escolhidos_em: claimed.pilares_escolhidos_em,
    });

  try {
    const meeting = await findExecutoriaMeeting({ meetingId });
    if (!meeting) throw new Error('reunião deixou de ser de um executor do ExecScore');
    if (meeting.executorId !== claimed.executor_id) {
      throw new Error('anfitrião da reunião mudou depois da transcrição');
    }
    // Marcada como onboarding/no-show depois de entrar na fila: não envia.
    const fora = motivoForaDoScore(meeting);
    if (fora) {
      await descartarEnvio(meetingId, fora);
      return 'nao_pronta';
    }

    const { text, used } = await loadTranscript(claimed.recording_ids);
    if (!text) throw new Error('nenhuma transcrição completa encontrada no armazenamento');

    const pilares = activePillars(claimed.pilares_desabilitados);
    const date = meeting.startedAt ?? meeting.scheduledStartAt;
    const res = await fetch(functionUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-execscore-internal-secret': process.env.EXECSCORE_INTERNAL_SECRET!,
      },
      body: JSON.stringify({
        transcript: text,
        executor_name: meeting.executorName,
        executor_id: meeting.executorId,
        pilares_selecionados: pilares,
        empresa_nome: meeting.clientName ?? undefined,
        data_reuniao: date
          ? new Date(date).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
          : undefined,
        evaluation_date: date ?? undefined,
        transcript_source: 'meet',
        transcript_filename: meeting.title ?? meeting.roomName,
        meeting_id: meeting.meetingId,
        meet_recording_ids: used,
      }),
      signal: AbortSignal.timeout(FUNCTION_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res.ok || !body?.id) {
      throw new Error(`ExecScore respondeu ${res.status}: ${body?.error ?? 'sem id da avaliação'}`);
    }

    await conclude(true, body.id, null);
    console.log(`execscore: reunião ${meetingId} enviada (avaliação ${body.id}, pilares ${pilares.join(',')})`);
    return 'enviada';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`execscore: falha ao enviar reunião ${meetingId}: ${msg}`);
    await conclude(false, null, msg).catch((e2) => console.error('execscore: concluir envio', e2));
    return 'erro';
  }
}

/** Envia o que estiver pronto: pilares escolhidos, prazo vencido ou erro a retentar. */
export async function sweep(limit = 20): Promise<{ tentadas: number; enviadas: number }> {
  const { data, error } = await createAdminSupabase().schema('execscore').rpc('meet_pendentes_envio', {
    p_espera: esperaInterval(),
    p_max_tentativas: MAX_TENTATIVAS,
    p_limite: limit,
  });
  if (error) throw new Error(`meet_pendentes_envio: ${error.message}`);
  const ids = ((data ?? []) as unknown[]).map((r) =>
    typeof r === 'string' ? r : (r as { meet_pendentes_envio?: string }).meet_pendentes_envio,
  ).filter((x): x is string => !!x);
  let enviadas = 0;
  // Em série: cada avaliação é uma chamada pesada de IA; não vale disparar 20 juntas.
  for (const id of ids) {
    if ((await dispatchMeeting(id)) === 'enviada') enviadas++;
  }
  return { tentadas: ids.length, enviadas };
}
