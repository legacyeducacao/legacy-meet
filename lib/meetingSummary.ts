/**
 * Resumo da reunião da Executoria: gerado pela IA quando a transcrição fica
 * pronta (o worker avisa o app) ou pelo botão na gravação. Guardado em
 * `resumos/<sala>.json` no MinIO, um por reunião (todas as partes juntas).
 * Serve de base para a próxima reunião com o mesmo cliente.
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getManifest, getObjectText, listJsonKeys, readJson, writeJson } from '@/lib/recordings';
import { joinTranscriptParts } from '@/lib/execscore';
import { llmEnabled, llmJson } from '@/lib/llm';
import {
  buildSummaryPrompt,
  isEmptyResumo,
  normalizeResumo,
  RESUMO_SCHEMA,
  type MeetingSummary,
} from '@/lib/meetingSummaryCore';

const MODEL = process.env.MEETING_SUMMARY_MODEL ?? 'gemini-2.5-flash';
export const summaryKey = (roomName: string) => `resumos/${roomName}.json`;

export function summaryEnabled(): boolean {
  return llmEnabled() && process.env.MEETING_SUMMARY_DISABLED !== '1';
}

export async function getSummary(roomName: string): Promise<MeetingSummary | null> {
  return readJson<MeetingSummary>(summaryKey(roomName));
}

type MeetingInfo = {
  meetingId: string;
  tenantId: string | null;
  title: string | null;
  clientName: string | null;
  executorName: string | null;
  startedAt: string | null;
  onboarding: boolean;
  sector: string | null;
};

function pick<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export async function getMeetingInfo(by: { roomName: string } | { meetingId: string }): Promise<MeetingInfo | null> {
  const admin = createAdminSupabase();
  let q = admin
    .from('meetings')
    .select(
      'id, tenant_id, title, started_at, scheduled_start_at, users:host_id(name), client_tenants:tenant_id(name), meet_meeting_sector(sector, onboarding)',
    );
  q = 'roomName' in by ? q.eq('room_name', by.roomName) : q.eq('id', by.meetingId);
  const { data: m } = await q.maybeSingle();
  if (!m) return null;
  const sec = pick(m.meet_meeting_sector as { sector?: string; onboarding?: boolean } | null);
  return {
    meetingId: m.id,
    tenantId: m.tenant_id ?? null,
    title: m.title?.trim() || null,
    clientName: pick(m.client_tenants as { name?: string | null } | null)?.name?.trim() || null,
    executorName: pick(m.users as { name?: string | null } | null)?.name?.trim() || null,
    startedAt: m.started_at ?? m.scheduled_start_at ?? null,
    onboarding: sec?.onboarding === true,
    sector: sec?.sector ?? null,
  };
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;

/**
 * Resumo mais recente de uma reunião da Executoria com o mesmo cliente,
 * anterior a `beforeIso`. Ignora a própria sala.
 */
export async function findPreviousSummary(
  tenantId: string,
  beforeIso: string,
  excludeRoom?: string,
): Promise<MeetingSummary | null> {
  const { data } = await createAdminSupabase()
    .from('meetings')
    .select('room_name, started_at, meet_meeting_sector!inner(sector)')
    .eq('tenant_id', tenantId)
    .eq('meet_meeting_sector.sector', 'executoria')
    .in('status', ['ended', 'live'])
    .not('started_at', 'is', null)
    .lt('started_at', beforeIso)
    .order('started_at', { ascending: false })
    .limit(8);
  for (const m of (data ?? []) as Array<{ room_name: string }>) {
    if (!m.room_name || m.room_name === excludeRoom) continue;
    const s = await getSummary(m.room_name);
    if (s) return s;
  }
  return null;
}

let methodologyCache: { at: number; text: string | null } | null = null;

/** Prompt ativo do ExecScore (metodologia do Executor Legacy), com cache de 10 min. */
async function getMethodology(): Promise<string | null> {
  if (methodologyCache && Date.now() - methodologyCache.at < 10 * 60_000) return methodologyCache.text;
  const { data } = await createAdminSupabase()
    .schema('execscore')
    .from('prompt_versions')
    .select('content')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const text = (data?.content as string | undefined)?.trim() || null;
  methodologyCache = { at: Date.now(), text };
  return text;
}

async function loadRoomTranscript(roomName: string): Promise<{ text: string; ids: string[] }> {
  const keys = await listJsonKeys(`manifests/${roomName}__`);
  const parts: Array<{ createdAt: string; text: string; id: string }> = [];
  for (const key of keys) {
    const id = key.slice('manifests/'.length, -'.json'.length);
    const m = await getManifest(id);
    if (!m || m.transcriptionStatus !== 'complete' || !m.transcriptTxtKey) continue;
    const text = (await getObjectText(m.transcriptTxtKey)) ?? '';
    if (text.trim()) parts.push({ createdAt: m.createdAt, text, id });
  }
  parts.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { text: joinTranscriptParts(parts), ids: parts.map((p) => p.id) };
}

export type SummaryResult =
  | { status: 'gerado'; summary: MeetingSummary }
  | { status: 'ignorado'; motivo: string };

const running = new Map<string, Promise<SummaryResult>>();

/** Gera (ou refaz) o resumo da reunião. Duas chamadas juntas para a mesma sala viram uma. */
export function generateSummary(roomName: string): Promise<SummaryResult> {
  const cur = running.get(roomName);
  if (cur) return cur;
  const p = doGenerate(roomName).finally(() => running.delete(roomName));
  running.set(roomName, p);
  return p;
}

async function doGenerate(roomName: string): Promise<SummaryResult> {
  if (!summaryEnabled()) return { status: 'ignorado', motivo: 'resumo desligado (sem chave da IA)' };
  const info = await getMeetingInfo({ roomName });
  if (!info) return { status: 'ignorado', motivo: 'reunião não encontrada' };
  if (info.sector !== 'executoria') return { status: 'ignorado', motivo: 'só reuniões da Executoria têm resumo' };

  const { text, ids } = await loadRoomTranscript(roomName);
  if (text.trim().length < 200) return { status: 'ignorado', motivo: 'transcrição vazia ou curta demais' };

  const [previous, methodology] = await Promise.all([
    info.tenantId && info.startedAt
      ? findPreviousSummary(info.tenantId, info.startedAt, roomName).catch(() => null)
      : Promise.resolve(null),
    getMethodology().catch(() => null),
  ]);

  const meetingDate = fmtDate(info.startedAt);
  const prompt = buildSummaryPrompt({
    transcript: text,
    title: info.title,
    clientName: info.clientName,
    executorName: info.executorName,
    meetingDate,
    onboarding: info.onboarding,
    previous,
    methodology,
  });
  const raw = await llmJson<unknown>({
    prompt,
    schema: RESUMO_SCHEMA,
    schemaName: 'resumo_reuniao',
    model: MODEL,
  });
  const resumo = normalizeResumo(raw);
  if (isEmptyResumo(resumo)) throw new Error('a IA devolveu um resumo vazio');

  const summary: MeetingSummary = {
    version: 1,
    roomName,
    meetingId: info.meetingId,
    recordingIds: ids,
    title: info.title,
    clientName: info.clientName,
    executorName: info.executorName,
    meetingDate,
    onboarding: info.onboarding,
    generatedAt: new Date().toISOString(),
    model: MODEL,
    ...resumo,
  };
  await writeJson(summaryKey(roomName), summary);
  console.log(`resumo: ${roomName} gerado (${ids.length} parte(s), ${text.length} caracteres)`);
  return { status: 'gerado', summary };
}
