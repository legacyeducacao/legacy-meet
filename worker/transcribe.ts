/**
 * Legacy Meet — Worker de transcrição (nativo, Node/TypeScript)
 *
 * Faz polling no bucket MinIO procurando gravações em `com-transcricao/` que
 * ainda não têm transcrição. Para cada uma, entrega o áudio a um provider de
 * transcrição (TRANSCRIPTION_PROVIDER: `gemini` = pipeline original em chunks
 * via OpenRouter; `assemblyai` = ASR dedicado com diarização, assíncrono) e
 * salva o resultado de volta no bucket (.json + .txt). Sem banco de dados.
 *
 * Providers assíncronos deixam um job em `asr-jobs/<id>.json`; o worker
 * acompanha o job a cada ciclo (marker `asr-done/` escrito pelo webhook do app
 * ou polling na API) e finaliza quando o resultado chega.
 */
import { createWriteStream, readFileSync } from 'node:fs';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Carrega .env (raiz do projeto e/ou worker/) sem sobrescrever variáveis já
// definidas no ambiente — útil para rodar local. No deploy as envs já existem.
function loadEnvFile(filePath: string) {
  try {
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  } catch {
    // arquivo ausente — tudo bem
  }
}
loadEnvFile(path.resolve(process.cwd(), '../.env'));
loadEnvFile(path.resolve(process.cwd(), '.env'));
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parsePlainTextToUtterances, utterancesToPlainText, type Utterance } from './lib/text';
import { normalizeUtterances } from './lib/speakers';
import { mergeParticipants } from './lib/participants';
import { getAudioDuration } from './lib/ffmpeg';
import { log, logJson, sleep } from './lib/log';
import {
  driveFindFileInFolder,
  driveFindOrCreateFolder,
  driveUploadFile,
  getDriveAccessToken,
  type DriveConfig,
} from './lib/drive';
import { WORKER_VERSION } from './version';
import type {
  AudioSource,
  PendingJob,
  ProviderName,
  TranscriptionProvider,
  TranscriptionResult,
} from './providers/types';
import { createGeminiProvider } from './providers/gemini';
import { createAssemblyAIProvider } from './providers/assemblyai';
import { AssemblyAIClient, AssemblyAIError, DEFAULT_SPEECH_MODEL } from './lib/assemblyai';
import { loadKeytermsFile } from './lib/keyterms';
import { applySpeakerMap, mapSpeakers, type SpeakerMap } from './lib/speakerMap';
import { assemblyAiLlmJson, DEFAULT_ASSEMBLYAI_LLM_MODEL, openRouterJson } from './lib/chatJson';

// ----------------------------- Config -----------------------------
const env = process.env;
const S3_ENDPOINT = env.S3_ENDPOINT;
const S3_KEY_ID = env.S3_KEY_ID;
const S3_KEY_SECRET = env.S3_KEY_SECRET;
const S3_REGION = env.S3_REGION ?? 'us-east-1';
const S3_BUCKET = env.S3_BUCKET ?? 'legacy-meet';
const TRANSCRIPTION_PROVIDER = (env.TRANSCRIPTION_PROVIDER ?? 'gemini') as ProviderName;
const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash';
const POLL_INTERVAL_SECONDS = Number(env.POLL_INTERVAL_SECONDS ?? '30');
const OPENROUTER_TIMEOUT_MS = Number(env.OPENROUTER_TIMEOUT_MS ?? '180000');
const CHUNK_SECONDS = Number(env.CHUNK_SECONDS ?? '300');
const SOURCE_PREFIX = env.SOURCE_PREFIX ?? 'com-transcricao/';
const OUTPUT_PREFIX = env.OUTPUT_PREFIX ?? 'transcricoes/';
const MANIFEST_PREFIX = env.MANIFEST_PREFIX ?? 'manifests/';
// Jobs assíncronos (providers que respondem depois) e markers do webhook.
const JOBS_PREFIX = env.JOBS_PREFIX ?? 'asr-jobs/';
const DONE_PREFIX = env.TRANSCRIPTION_DONE_PREFIX ?? 'asr-done/';
// Prazo máximo para um job assíncrono responder antes de virar "failed".
const JOB_MAX_WAIT_MINUTES = Number(env.ASSEMBLYAI_MAX_WAIT_MINUTES ?? '180');
// Validade da URL assinada entregue ao provider (precisa cobrir fila + download).
const SIGNED_URL_TTL_SECONDS = Number(env.SIGNED_URL_TTL_SECONDS ?? '43200');

// AssemblyAI (TRANSCRIPTION_PROVIDER=assemblyai).
const ASSEMBLYAI_API_KEY = env.ASSEMBLYAI_API_KEY;
const ASSEMBLYAI_SPEECH_MODEL = env.ASSEMBLYAI_SPEECH_MODEL ?? DEFAULT_SPEECH_MODEL;
const ASSEMBLYAI_LANGUAGE_CODE = env.ASSEMBLYAI_LANGUAGE_CODE ?? 'pt';
const ASSEMBLYAI_TIMEOUT_MS = Number(env.ASSEMBLYAI_TIMEOUT_MS ?? '60000');
const ASSEMBLYAI_USE_PARTICIPANT_COUNT = (env.ASSEMBLYAI_USE_PARTICIPANT_COUNT ?? 'true') !== 'false';
const ASSEMBLYAI_SENTIMENT = env.ASSEMBLYAI_SENTIMENT === 'true';
const ASSEMBLYAI_ENTITIES = env.ASSEMBLYAI_ENTITIES === 'true';
const ASSEMBLYAI_RATE_USD_PER_HOUR = env.ASSEMBLYAI_RATE_USD_PER_HOUR
  ? Number(env.ASSEMBLYAI_RATE_USD_PER_HOUR)
  : undefined;
const ASSEMBLYAI_POLL_MIN_SECONDS = Number(env.ASSEMBLYAI_POLL_MIN_SECONDS ?? '60');
const ASSEMBLYAI_POLL_MAX_SECONDS = Number(env.ASSEMBLYAI_POLL_MAX_SECONDS ?? '300');
// Webhook: o app recebe o callback e grava o marker; sem secret ou URL base, só polling.
const ASSEMBLYAI_WEBHOOK_SECRET = env.ASSEMBLYAI_WEBHOOK_SECRET;
const APP_BASE_URL = env.APP_BASE_URL;
const KEYTERMS_FILE = env.KEYTERMS_FILE ?? path.resolve(process.cwd(), 'config/keyterms.json');
// Mapeamento rótulo (A/B/C) → nome via LLM. Com o provider assemblyai a
// chamada vai ao LLM Gateway da própria AssemblyAI (mesma chave; pipeline em
// um fornecedor só); com OpenRouter configurado e SPEAKER_MAP_VIA=openrouter,
// vai ao OpenRouter. Abaixo desta confiança o rótulo genérico fica
// ("Falante A") em vez de chutar.
const SPEAKER_MAP_MIN_CONFIDENCE = Number(env.SPEAKER_MAP_MIN_CONFIDENCE ?? '0.7');
const SPEAKER_MAP_VIA = env.SPEAKER_MAP_VIA ?? (TRANSCRIPTION_PROVIDER === 'assemblyai' ? 'assemblyai' : 'openrouter');
const SPEAKER_MAP_MODEL =
  env.SPEAKER_MAP_MODEL ?? (SPEAKER_MAP_VIA === 'assemblyai' ? DEFAULT_ASSEMBLYAI_LLM_MODEL : OPENROUTER_MODEL);
const SPEAKER_MAP_TIMEOUT_MS = Number(env.SPEAKER_MAP_TIMEOUT_MS ?? '60000');

// Google Drive (opcional): se configurado, arquiva o vídeo no Drive e remove do MinIO.
const GOOGLE_OAUTH_CLIENT_ID = env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_OAUTH_CLIENT_SECRET = env.GOOGLE_OAUTH_CLIENT_SECRET;
const GOOGLE_OAUTH_REFRESH_TOKEN = env.GOOGLE_OAUTH_REFRESH_TOKEN;
const GOOGLE_DRIVE_FOLDER_ID = env.GOOGLE_DRIVE_FOLDER_ID;
const DRIVE_TIMEOUT_MS = Number(env.DRIVE_TIMEOUT_MS ?? '120000');
const DRIVE_CFG: DriveConfig = {
  clientId: GOOGLE_OAUTH_CLIENT_ID ?? '',
  clientSecret: GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  refreshToken: GOOGLE_OAUTH_REFRESH_TOKEN ?? '',
};
const DRIVE_ENABLED = !!(
  GOOGLE_OAUTH_CLIENT_ID &&
  GOOGLE_OAUTH_CLIENT_SECRET &&
  GOOGLE_OAUTH_REFRESH_TOKEN
);

if (!S3_ENDPOINT || !S3_KEY_ID || !S3_KEY_SECRET) {
  console.error('Faltam variáveis de ambiente: S3_ENDPOINT, S3_KEY_ID, S3_KEY_SECRET');
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: { accessKeyId: S3_KEY_ID, secretAccessKey: S3_KEY_SECRET },
  forcePathStyle: true,
});

let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    log(`sinal ${sig} recebido — encerrando após o job atual`);
    shuttingDown = true;
  });
}

// --------------------------- Provider ---------------------------
function createProvider(): TranscriptionProvider {
  if (TRANSCRIPTION_PROVIDER === 'gemini') {
    if (!OPENROUTER_API_KEY) {
      console.error('TRANSCRIPTION_PROVIDER=gemini exige OPENROUTER_API_KEY');
      process.exit(1);
    }
    return createGeminiProvider({
      apiKey: OPENROUTER_API_KEY,
      model: OPENROUTER_MODEL,
      timeoutMs: OPENROUTER_TIMEOUT_MS,
      chunkSeconds: CHUNK_SECONDS,
    });
  }
  if (TRANSCRIPTION_PROVIDER === 'assemblyai') {
    if (!ASSEMBLYAI_API_KEY) {
      console.error('TRANSCRIPTION_PROVIDER=assemblyai exige ASSEMBLYAI_API_KEY');
      process.exit(1);
    }
    const keyterms = loadKeytermsFile(KEYTERMS_FILE);
    const webhook =
      ASSEMBLYAI_WEBHOOK_SECRET && APP_BASE_URL
        ? { baseUrl: APP_BASE_URL, headerName: 'X-Legacy-Webhook-Secret', headerValue: ASSEMBLYAI_WEBHOOK_SECRET }
        : undefined;
    log(
      `assemblyai: modelo=${ASSEMBLYAI_SPEECH_MODEL} idioma=${ASSEMBLYAI_LANGUAGE_CODE} ` +
        `keyterms=${keyterms.length} (${KEYTERMS_FILE}) webhook=${webhook ? 'on' : 'off (só polling)'} ` +
        `falantes=${SPEAKER_MAP_VIA}/${SPEAKER_MAP_MODEL}`,
    );
    return createAssemblyAIProvider({
      client: new AssemblyAIClient({
        apiKey: ASSEMBLYAI_API_KEY,
        timeoutMs: ASSEMBLYAI_TIMEOUT_MS,
        onRetry: (attempt, e, delayMs) =>
          log(`assemblyai: tentativa ${attempt} falhou (${e instanceof Error ? e.message : e}) — retry em ${delayMs}ms`),
      }),
      speechModel: ASSEMBLYAI_SPEECH_MODEL,
      languageCode: ASSEMBLYAI_LANGUAGE_CODE,
      keyterms,
      useParticipantCount: ASSEMBLYAI_USE_PARTICIPANT_COUNT,
      addons: { sentiment: ASSEMBLYAI_SENTIMENT, entities: ASSEMBLYAI_ENTITIES },
      webhook,
      ratePerHourUsd: ASSEMBLYAI_RATE_USD_PER_HOUR,
      pollMinIntervalMs: ASSEMBLYAI_POLL_MIN_SECONDS * 1000,
      pollMaxIntervalMs: ASSEMBLYAI_POLL_MAX_SECONDS * 1000,
    });
  }
  console.error(`TRANSCRIPTION_PROVIDER inválido: ${TRANSCRIPTION_PROVIDER} (use gemini ou assemblyai)`);
  process.exit(1);
}
const provider = createProvider();

// --------------------------- S3 helpers ---------------------------
interface RecordingObject {
  key: string;
  lastModified?: Date;
}

async function listPendingRecordings(): Promise<RecordingObject[]> {
  const out: RecordingObject[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: SOURCE_PREFIX, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Key.toLowerCase().endsWith('.mp4')) {
        out.push({ key: obj.Key, lastModified: obj.LastModified });
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

function recordingIdFromKey(recordingKey: string): string {
  return path.basename(recordingKey).replace(/\.mp4$/i, '');
}

const sourceKey = (id: string) => `${SOURCE_PREFIX}${id}.mp4`;

// Extrai o horário de INÍCIO da reunião do id "<sala>__<stamp>", onde stamp é o
// ISO gerado no /api/record/start (quando alguém entrou) com [:.] trocados por -.
// Ex.: "ecok-srde__2026-06-03T17-18-30-989Z" → 2026-06-03T17:18:30.989Z.
function startTimeFromId(id: string): Date | null {
  const stamp = id.split('__')[1];
  const m = stamp?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return isNaN(d.getTime()) ? null : d;
}

function transcriptKey(id: string, ext: string): string {
  return `${OUTPUT_PREFIX}${id}.${ext}`;
}

function manifestKey(id: string): string {
  return `${MANIFEST_PREFIX}${id}.json`;
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

const manifestExists = (id: string) => objectExists(manifestKey(id));

// Um MP4 recém-modificado pode ainda estar sendo enviado pelo egress — processar
// um arquivo parcial gera áudio corrompido e alucinação. Processa quando existe
// o marker `ready/<id>.json` (webhook egress_ended ou requeue) OU quando o
// arquivo está "frio" há EGRESS_MIN_AGE_SECONDS.
const EGRESS_MIN_AGE_SECONDS = Number(env.EGRESS_MIN_AGE_SECONDS ?? '120');

async function isEgressReady(id: string, lastModified?: Date): Promise<boolean> {
  if (await objectExists(`ready/${id}.json`)) return true;
  const ageSeconds = lastModified ? (Date.now() - lastModified.getTime()) / 1000 : Infinity;
  return ageSeconds >= EGRESS_MIN_AGE_SECONDS;
}

// Cap de tentativas por gravação: sem isso, uma gravação quebrada era retentada
// a cada poll para sempre (queimando créditos em loop).
const MAX_RECORDING_ATTEMPTS = Number(env.MAX_RECORDING_ATTEMPTS ?? '3');

async function readAttempts(id: string): Promise<number> {
  try {
    return Number(JSON.parse((await getObjectTextOrNull(`attempts/${id}.json`)) ?? '{"count":0}').count ?? 0);
  } catch {
    return 0;
  }
}

async function bumpAttempts(id: string): Promise<number> {
  const key = `attempts/${id}.json`;
  const count = (await readAttempts(id)) + 1;
  await uploadText(key, JSON.stringify({ count }), 'application/json');
  return count;
}

// Manifesto mínimo de falha: a gravação aparece na listagem como "failed" (com o
// botão "Transcrever novamente") em vez de sumir e ser retentada eternamente.
async function writeFailedManifest(
  id: string,
  reason: string,
  extra: { providerTranscriptId?: string; lastModified?: Date } = {},
): Promise<void> {
  const roomName = id.split('__')[0];
  const createdAt = (startTimeFromId(id) ?? extra.lastModified ?? new Date()).toISOString();
  const meta = await getMeta(roomName);
  const manifest = {
    id,
    title: (meta?.title || '').trim(),
    roomName,
    createdAt,
    durationSeconds: 0,
    storage: 's3' as const,
    videoKey: sourceKey(id),
    gdriveFileId: null,
    gdriveFolderId: null,
    transcriptTxtKey: transcriptKey(id, 'txt'),
    transcriptionStatus: 'failed' as const,
    model: provider.name === 'gemini' ? OPENROUTER_MODEL : provider.name,
    provider: provider.name,
    providerTranscriptId: extra.providerTranscriptId,
    workerVersion: WORKER_VERSION,
    transcriptionError: reason,
    participants: meta?.participants ?? [],
    skippedChunks: [],
    skippedChunkDetails: [{ chunk: 0, offsetSeconds: 0, reason }],
    utterances: [],
  };
  await uploadText(manifestKey(id), JSON.stringify(manifest, null, 2), 'application/json');
  await deleteJob(id).catch(() => {});
  if (extra.providerTranscriptId) {
    await deleteObject(doneMarkerKey(extra.providerTranscriptId)).catch(() => {});
  }
  logJson('transcription_failed', { recordingId: id, provider: provider.name, reason });
}

async function downloadToFile(key: string, dst: string) {
  const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  await pipeline(res.Body as Readable, createWriteStream(dst));
}

async function uploadText(key: string, body: string, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

async function getObjectTextOrNull(key: string): Promise<string | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return await (res.Body as any).transformToString();
  } catch {
    return null;
  }
}

async function listKeys(prefix: string, ext: string): Promise<string[]> {
  const ids: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Key.endsWith(ext)) {
        ids.push(obj.Key.slice(prefix.length).slice(0, -ext.length));
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return ids;
}

const listManifestIds = () => listKeys(MANIFEST_PREFIX, '.json');

async function readManifest(id: string): Promise<any | null> {
  const txt = await getObjectTextOrNull(manifestKey(id));
  if (txt == null) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

interface MeetingMeta {
  title?: string;
  host?: string;
  participants?: string[];
}

async function getMeta(roomName: string): Promise<MeetingMeta | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: `meta/${roomName}.json` }));
    const text = await (res.Body as any).transformToString();
    return JSON.parse(text) as MeetingMeta;
  } catch {
    return null;
  }
}

// Fonte de áudio da gravação: URL assinada do MinIO (provider baixa de fora)
// ou download local (provider que precisa do arquivo, ex. ffmpeg).
function makeAudioSource(key: string): AudioSource {
  return {
    label: 'mix',
    signedUrl: () =>
      getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), {
        expiresIn: SIGNED_URL_TTL_SECONDS,
      }),
    downloadTo: (dst) => downloadToFile(key, dst),
  };
}

// --------------------------- Jobs assíncronos ---------------------------
const jobKey = (id: string) => `${JOBS_PREFIX}${id}.json`;
const doneMarkerKey = (jobId: string) => `${DONE_PREFIX}${jobId}.json`;

async function readJob(id: string): Promise<PendingJob | null> {
  const txt = await getObjectTextOrNull(jobKey(id));
  if (txt == null) return null;
  try {
    return JSON.parse(txt) as PendingJob;
  } catch {
    return null;
  }
}

const writeJob = (job: PendingJob) =>
  uploadText(jobKey(job.recordingId), JSON.stringify(job, null, 2), 'application/json');

const deleteJob = (id: string) => deleteObject(jobKey(id));

function formatDateTimeBR(iso: string): string {
  // timeZone explícito (ICU embutido no Node) garante data/hora de São Paulo mesmo
  // sem tzdata no container e sem depender da env TZ. Ex.: "03/06/2026 - 16h30".
  const d = new Date(iso);
  const date = d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const time = d
    .toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replace(':', 'h');
  return `${date} - ${time}`;
}

// Sobe vídeo + txt pro Drive de forma idempotente (reusa pasta/arquivo se já
// existirem). Lança se o Drive falhar — o chamador trata com fallback s3.
async function archiveVideoToDrive(
  token: string,
  videoPath: string,
  id: string,
  folderName: string,
  plainText: string,
  tmpDir: string,
): Promise<{ folderId: string; fileId: string }> {
  const folderId = await driveFindOrCreateFolder(token, folderName, GOOGLE_DRIVE_FOLDER_ID, DRIVE_TIMEOUT_MS);
  let fileId = await driveFindFileInFolder(token, `${id}.mp4`, folderId, DRIVE_TIMEOUT_MS);
  if (!fileId) {
    fileId = await driveUploadFile(token, videoPath, `${id}.mp4`, 'video/mp4', folderId, DRIVE_TIMEOUT_MS);
  }
  if (!(await driveFindFileInFolder(token, `${id}.txt`, folderId, DRIVE_TIMEOUT_MS))) {
    const txtPath = path.join(tmpDir, 'transcricao.txt');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(txtPath, plainText, 'utf-8');
    await driveUploadFile(token, txtPath, `${id}.txt`, 'text/plain', folderId, DRIVE_TIMEOUT_MS);
  }
  return { folderId, fileId };
}

// Migra pro Drive as gravações que ficaram como storage=s3 (Drive estava fora
// quando processaram). Reusa as falas do manifesto — NÃO re-transcreve. Quando
// o Drive volta, tudo que acumulou migra sozinho.
async function reconcileS3Recordings(): Promise<void> {
  if (!DRIVE_ENABLED) return;
  let token: string | null = null;
  for (const id of await listManifestIds()) {
    if (shuttingDown) break;
    const m = await readManifest(id);
    if (!m || m.storage !== 's3' || !m.videoKey) continue;

    const tmp = await mkdtemp(path.join(tmpdir(), 'reconcile-'));
    try {
      const videoPath = path.join(tmp, 'recording.mp4');
      await downloadToFile(m.videoKey, videoPath);
      const plainText = utterancesToPlainText((m.utterances ?? []) as Utterance[]);
      const folderName = `${formatDateTimeBR(m.createdAt)} - ${m.title || m.roomName}`;
      if (!token) token = await getDriveAccessToken(DRIVE_CFG, DRIVE_TIMEOUT_MS);
      log(`migrando pro Drive: ${id} → "${folderName}"`);
      const res = await archiveVideoToDrive(token, videoPath, id, folderName, plainText, tmp);
      const updated = { ...m, storage: 'gdrive', videoKey: null, gdriveFolderId: res.folderId, gdriveFileId: res.fileId };
      await uploadText(manifestKey(id), JSON.stringify(updated, null, 2), 'application/json');
      await deleteObject(m.videoKey);
      log(`migrado pro Drive: ${id}`);
    } catch (e) {
      log(`migração adiada para ${id}: ${e instanceof Error ? e.message : String(e)}`);
      token = null; // força novo token na próxima (caso auth tenha expirado)
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}

// --------------------------- Processamento ---------------------------
interface RecordingContext {
  id: string;
  key: string;
  roomName: string;
  createdAt: string;
  title: string;
  participants: string[];
  /** Anfitrião/condutor da reunião — evidência de papel para o mapeamento de falantes. */
  host: string;
}

async function loadContext(id: string, lastModified?: Date): Promise<RecordingContext> {
  const roomName = id.split('__')[0];
  // Início da reunião (do nome do arquivo). Cai no lastModified só se o id não
  // tiver o stamp esperado.
  const createdAt = (startTimeFromId(id) ?? lastModified ?? new Date()).toISOString();
  const meta = await getMeta(roomName);
  // Canonicaliza também na LEITURA: metas antigos podem ter o mesmo nome em
  // variações ("MARIZA"/"Mariza") — cada variante extra divide a mesma voz em
  // dois speakers.
  const participants = mergeParticipants(
    [],
    meta?.participants?.length ? meta.participants : meta?.host ? [meta.host] : [],
  );
  return {
    id,
    key: sourceKey(id),
    roomName,
    createdAt,
    title: (meta?.title || '').trim(),
    participants,
    host: (meta?.host || '').trim(),
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Etapa final comum a todos os providers: normaliza as falas, grava o txt,
 * arquiva no Drive (à prova de falha) e escreve o manifesto. Só depois do
 * manifesto o .mp4 sai do MinIO — nunca entra em loop de reprocesso.
 */
async function finalizeRecording(
  ctx: RecordingContext,
  result: TranscriptionResult,
  tmpDir: string,
  startedAt: number,
): Promise<void> {
  const { id, key, roomName, createdAt, title, participants, host } = ctx;

  // Providers de ASR devolvem rótulos genéricos (A, B, C): mapeia para os
  // participantes conhecidos com o LLM antes de normalizar.
  let utterances = result.utterances;
  let speakerMap: SpeakerMap | undefined;
  if (result.rawSpeakerLabels && utterances.length) {
    const mapped = await resolveSpeakerMap(id, utterances, participants, host);
    speakerMap = mapped.map;
    utterances = applySpeakerMap(utterances, mapped.map);
    log(`falantes (${mapped.source}): ${Object.entries(mapped.map).map(([l, n]) => `${l}→${n}`).join(', ')}`);
  }

  // Normalização final: casa rótulos com nomes reais, ordena e funde falas
  // consecutivas do mesmo speaker.
  const finalUtts = normalizeUtterances(utterances, participants);
  const skipped = result.skippedChunks;

  const transcriptionFailed = finalUtts.length === 0 && skipped.length > 0;
  if (transcriptionFailed) {
    log(`transcrição falhou (chunks pulados: ${skipped.join(', ')}) — arquivando vídeo mesmo assim`);
  }

  // txt de referência no MinIO (regravado a partir das falas atuais).
  const plainText = utterancesToPlainText(finalUtts);
  await uploadText(transcriptKey(id, 'txt'), plainText, 'text/plain; charset=utf-8');

  // Arquivamento no Drive à prova de falha: se falhar, cai em s3 (vídeo fica
  // no MinIO) e MESMO ASSIM grava o manifesto — nunca entra em loop.
  let storage: 's3' | 'gdrive' = 's3';
  let gdriveFileId: string | null = null;
  let gdriveFolderId: string | null = null;
  let videoKey: string | null = key;

  if (DRIVE_ENABLED) {
    const folderName = `${formatDateTimeBR(createdAt)} - ${title || roomName}`;
    try {
      const videoPath = path.join(tmpDir, 'recording.mp4');
      if (!(await fileExists(videoPath))) await downloadToFile(key, videoPath);
      log(`arquivando no Google Drive em "${folderName}"`);
      const token = await getDriveAccessToken(DRIVE_CFG, DRIVE_TIMEOUT_MS);
      const res = await archiveVideoToDrive(token, videoPath, id, folderName, plainText, tmpDir);
      gdriveFolderId = res.folderId;
      gdriveFileId = res.fileId;
      storage = 'gdrive';
      videoKey = null;
      log(`arquivado no Drive (pasta=${gdriveFolderId}, vídeo=${gdriveFileId})`);
    } catch (e) {
      log(`falha ao arquivar no Drive: ${e instanceof Error ? e.message : String(e)} — mantendo no MinIO (storage=s3)`);
    }
  }

  const manifest = {
    id,
    title,
    roomName,
    createdAt,
    durationSeconds: result.durationSeconds,
    storage,
    videoKey,
    gdriveFileId,
    gdriveFolderId,
    transcriptTxtKey: transcriptKey(id, 'txt'),
    transcriptionStatus: transcriptionFailed ? ('failed' as const) : ('complete' as const),
    model: result.model,
    // Rastreabilidade: quem transcreveu, com que modelo, com que versão do worker.
    provider: provider.name,
    providerTranscriptId: result.providerTranscriptId,
    speechModel: result.model,
    workerVersion: WORKER_VERSION,
    audioDurationSeconds: result.audioDurationSeconds,
    estimatedCostUsd: result.estimatedCostUsd,
    speakerMap,
    participants,
    skippedChunks: skipped,
    skippedChunkDetails: result.skippedChunkDetails,
    ...result.diagnostics,
    utterances: finalUtts,
  };
  await uploadText(manifestKey(id), JSON.stringify(manifest, null, 2), 'application/json');

  // Limpa os markers de controle (tentativas, "egress pronto", job assíncrono).
  await deleteObject(`attempts/${id}.json`).catch(() => {});
  await deleteObject(`ready/${id}.json`).catch(() => {});
  await deleteJob(id).catch(() => {});
  if (result.providerTranscriptId) {
    await deleteObject(doneMarkerKey(result.providerTranscriptId)).catch(() => {});
  }

  // Só remove o .mp4 do MinIO DEPOIS do manifesto e SÓ se foi pro Drive.
  if (storage === 'gdrive') {
    await deleteObject(key);
  }

  logJson('transcription_completed', {
    recordingId: id,
    provider: provider.name,
    transcriptId: result.providerTranscriptId ?? null,
    model: result.model,
    utterances: finalUtts.length,
    durationSeconds: result.durationSeconds,
    audioSeconds: result.audioDurationSeconds ?? null,
    costUsd: result.estimatedCostUsd ?? null,
    elapsedMs: Date.now() - startedAt,
    storage,
    skippedChunks: skipped.length,
  });
  log(
    `concluído ${id} — ${finalUtts.length} utterances, storage=${storage}${
      skipped.length ? ` (chunks pulados: ${skipped.join(', ')})` : ''
    }`,
  );
}

// Sem chave para o LLM o mapeamento é pulado (rótulos genéricos) — a
// transcrição em si não depende dele.
async function resolveSpeakerMap(
  id: string,
  utterances: Utterance[],
  participants: string[],
  host?: string,
) {
  const startedAt = Date.now();
  const r = await mapSpeakers(utterances, participants, {
    minConfidence: SPEAKER_MAP_MIN_CONFIDENCE,
    host,
    llm: async ({ prompt, schema }) => {
      const common = { model: SPEAKER_MAP_MODEL, prompt, schema, schemaName: 'speaker_map', timeoutMs: SPEAKER_MAP_TIMEOUT_MS };
      if (SPEAKER_MAP_VIA === 'assemblyai') {
        if (!ASSEMBLYAI_API_KEY) throw new Error('ASSEMBLYAI_API_KEY ausente — mapeamento de falantes pulado');
        return assemblyAiLlmJson({ apiKey: ASSEMBLYAI_API_KEY, ...common });
      }
      if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY ausente — mapeamento de falantes pulado');
      return openRouterJson({ apiKey: OPENROUTER_API_KEY, ...common });
    },
  });
  logJson('speaker_map', {
    recordingId: id,
    via: SPEAKER_MAP_VIA,
    model: SPEAKER_MAP_MODEL,
    source: r.source,
    map: r.map,
    elapsedMs: Date.now() - startedAt,
  });
  return r;
}

async function processRecording(rec: RecordingObject) {
  const id = recordingIdFromKey(rec.key);
  const startedAt = Date.now();
  log(`processando ${rec.key} (id=${id}) via ${provider.name}`);

  const tmp = await mkdtemp(path.join(tmpdir(), 'transcribe-'));
  try {
    const ctx = await loadContext(id, rec.lastModified);
    if (ctx.participants.length) log(`participantes: ${ctx.participants.join(', ')}`);

    // Reuso de backlog: se já existe transcrição (txt) no MinIO de um run
    // anterior, reconstrói as falas dela em vez de re-transcrever (economiza
    // créditos). Gravação nova não tem txt → transcreve normalmente.
    const existingTxt = await getObjectTextOrNull(transcriptKey(id, 'txt'));
    if (existingTxt && existingTxt.trim()) {
      const reused = parsePlainTextToUtterances(existingTxt);
      log(`reaproveitando transcrição existente do MinIO — ${reused.length} utterance(s)`);
      const videoPath = path.join(tmp, 'recording.mp4');
      await downloadToFile(rec.key, videoPath);
      const durationSeconds = Math.round(await getAudioDuration(videoPath));
      await finalizeRecording(
        ctx,
        {
          utterances: reused,
          // Speakers do txt já são nomes (ou "Desconhecido"): nada a mapear.
          rawSpeakerLabels: false,
          durationSeconds,
          model: 'reuso-txt',
          skippedChunks: [],
          skippedChunkDetails: [],
          diagnostics: {},
        },
        tmp,
        startedAt,
      );
      return;
    }

    const outcome = await provider.submit({
      id,
      roomName: ctx.roomName,
      participants: ctx.participants,
      tmpDir: tmp,
      attempt: await readAttempts(id),
      sources: [makeAudioSource(rec.key)],
    });

    if (outcome.kind === 'completed') {
      await finalizeRecording(ctx, outcome.result, tmp, startedAt);
    } else if (outcome.kind === 'pending') {
      // Provider assíncrono: registra o job e volta a acompanhar nos próximos
      // ciclos. O job persistido evita resubmeter (e pagar de novo) se o worker
      // reiniciar no meio da espera.
      await writeJob({
        recordingId: id,
        jobId: outcome.jobId,
        submittedAt: new Date().toISOString(),
        lastCheckedAt: null,
        checks: 0,
      });
      logJson('transcription_submitted', {
        recordingId: id,
        provider: provider.name,
        transcriptId: outcome.jobId,
      });
    } else if (outcome.retryable) {
      throw new Error(outcome.reason);
    } else {
      await writeFailedManifest(id, outcome.reason, { lastModified: rec.lastModified });
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// Acompanha os jobs assíncronos: marker do webhook (imediato) ou polling na API
// (fallback). Estourou o prazo → failed (o vídeo continua no MinIO; "Transcrever
// novamente" reprocessa).
async function processPendingJobs(): Promise<boolean> {
  let didWork = false;
  for (const id of await listKeys(JOBS_PREFIX, '.json')) {
    if (shuttingDown) break;
    const job = await readJob(id);
    if (!job) continue;
    if (await manifestExists(id)) {
      // Já finalizada por outro caminho — job órfão.
      await deleteJob(id).catch(() => {});
      continue;
    }

    // Marker do webhook vence o prazo: se a AssemblyAI terminou enquanto o
    // worker esteve fora, o resultado (já pago) é aproveitado em vez de virar
    // timeout.
    const doneMarker = await objectExists(doneMarkerKey(job.jobId));
    const waitedMs = Date.now() - new Date(job.submittedAt).getTime();
    if (!doneMarker && waitedMs > JOB_MAX_WAIT_MINUTES * 60_000) {
      logJson('transcription_timeout', { recordingId: id, transcriptId: job.jobId, waitedMs });
      await writeFailedManifest(id, `sem resposta do provider em ${JOB_MAX_WAIT_MINUTES} min`, {
        providerTranscriptId: job.jobId,
      });
      continue;
    }

    let outcome;
    try {
      outcome = await provider.poll(job, { doneMarker });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`poll de ${id} falhou: ${msg}`);
      // 4xx (chave revogada, transcrição inexistente) não muda sozinho: falha
      // definitiva. Rede/5xx: registra a consulta para o backoff valer.
      if (e instanceof AssemblyAIError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        await writeFailedManifest(id, `consulta do job: ${msg}`, { providerTranscriptId: job.jobId });
      } else {
        await writeJob({ ...job, lastCheckedAt: new Date().toISOString(), checks: job.checks + 1 });
      }
      continue;
    }

    if (outcome.kind === 'pending') {
      if (outcome.checked) {
        await writeJob({ ...job, lastCheckedAt: new Date().toISOString(), checks: job.checks + 1 });
      }
      continue;
    }

    didWork = true;
    if (outcome.kind === 'error') {
      if (outcome.retryable) {
        // Volta para a fila de gravações (o .mp4 continua em com-transcricao/),
        // respeitando o cap de tentativas para não ficar em loop.
        log(`job ${id} descartado (${outcome.reason}) — gravação volta para a fila`);
        await deleteJob(id).catch(() => {});
        await deleteObject(doneMarkerKey(job.jobId)).catch(() => {});
        const attempts = await bumpAttempts(id);
        if (attempts >= MAX_RECORDING_ATTEMPTS) {
          await writeFailedManifest(id, outcome.reason, { providerTranscriptId: job.jobId });
        }
      } else {
        await writeFailedManifest(id, outcome.reason, { providerTranscriptId: job.jobId });
      }
      continue;
    }

    const startedAt = new Date(job.submittedAt).getTime();
    const tmp = await mkdtemp(path.join(tmpdir(), 'transcribe-'));
    try {
      const ctx = await loadContext(id);
      await finalizeRecording(ctx, outcome.result, tmp, startedAt);
    } catch (e) {
      log(`falha ao finalizar ${id}: ${e instanceof Error ? e.message : String(e)}`);
      const attempts = await bumpAttempts(id);
      if (attempts >= MAX_RECORDING_ATTEMPTS) {
        await writeFailedManifest(id, e instanceof Error ? e.message : String(e), {
          providerTranscriptId: job.jobId,
        });
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  return didWork;
}

async function main() {
  log(
    `worker de transcrição iniciado — provider=${provider.name} versão=${WORKER_VERSION} ` +
      `bucket=${S3_BUCKET} prefixo=${SOURCE_PREFIX} poll=${POLL_INTERVAL_SECONDS}s ` +
      `drive=${DRIVE_ENABLED ? 'on' : 'off'}`,
  );
  while (!shuttingDown) {
    try {
      const recordings = await listPendingRecordings();
      let processedAny = false;
      for (const rec of recordings) {
        if (shuttingDown) break;
        const id = recordingIdFromKey(rec.key);
        if (await manifestExists(id)) continue;
        // Já submetida a um provider assíncrono: quem cuida é processPendingJobs.
        if (await readJob(id)) continue;
        if (!(await isEgressReady(id, rec.lastModified))) {
          log(`aguardando egress finalizar ${rec.key} (arquivo modificado há pouco)`);
          continue;
        }
        processedAny = true;
        try {
          await processRecording(rec);
        } catch (e) {
          log(`falha ao processar ${rec.key}: ${e}`);
          try {
            const attempts = await bumpAttempts(id);
            if (attempts >= MAX_RECORDING_ATTEMPTS) {
              log(`${id} falhou ${attempts}x — marcando como failed para parar o loop de retries`);
              await writeFailedManifest(id, e instanceof Error ? e.message : String(e), {
                lastModified: rec.lastModified,
              });
            }
          } catch (e2) {
            log(`falha ao registrar tentativa de ${id}: ${e2}`);
          }
          // Espera antes da próxima tentativa: sem isso uma indisponibilidade
          // transitória de segundos (MinIO reiniciando) consumia as 3 tentativas
          // em sequência e marcava a gravação como failed para sempre.
          await sleep(POLL_INTERVAL_SECONDS * 1000);
        }
      }
      if (!shuttingDown && (await processPendingJobs())) processedAny = true;
      if (!shuttingDown) await reconcileS3Recordings();
      if (!processedAny) await sleep(POLL_INTERVAL_SECONDS * 1000);
    } catch (e) {
      log(`erro no loop: ${e} - aguardando e tentando de novo`);
      await sleep(POLL_INTERVAL_SECONDS * 1000);
    }
  }
  log('worker encerrando');
}

void main();
