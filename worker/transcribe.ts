/**
 * Legacy Meet — Worker de transcrição (nativo, Node/TypeScript)
 *
 * Faz polling no bucket MinIO procurando gravações em `com-transcricao/` que
 * ainda não têm transcrição. Para cada uma: baixa o MP4, extrai o áudio com
 * ffmpeg, divide em chunks, transcreve via OpenRouter (modelo multimodal, ex:
 * Gemini 2.5 Flash) com saída estruturada (speaker + timestamps) e salva o
 * resultado de volta no bucket (.json + .txt). Sem banco de dados.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

// ----------------------------- Config -----------------------------
const env = process.env;
const S3_ENDPOINT = env.S3_ENDPOINT;
const S3_KEY_ID = env.S3_KEY_ID;
const S3_KEY_SECRET = env.S3_KEY_SECRET;
const S3_REGION = env.S3_REGION ?? 'us-east-1';
const S3_BUCKET = env.S3_BUCKET ?? 'legacy-meet';
const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash';
const POLL_INTERVAL_SECONDS = Number(env.POLL_INTERVAL_SECONDS ?? '30');
const CHUNK_SECONDS = Number(env.CHUNK_SECONDS ?? '300');
const SOURCE_PREFIX = env.SOURCE_PREFIX ?? 'com-transcricao/';
const OUTPUT_PREFIX = env.OUTPUT_PREFIX ?? 'transcricoes/';
const MANIFEST_PREFIX = env.MANIFEST_PREFIX ?? 'manifests/';

// Google Drive (opcional): se configurado, arquiva o vídeo no Drive e remove do MinIO.
const GOOGLE_OAUTH_CLIENT_ID = env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_OAUTH_CLIENT_SECRET = env.GOOGLE_OAUTH_CLIENT_SECRET;
const GOOGLE_OAUTH_REFRESH_TOKEN = env.GOOGLE_OAUTH_REFRESH_TOKEN;
const GOOGLE_DRIVE_FOLDER_ID = env.GOOGLE_DRIVE_FOLDER_ID;
const DRIVE_ENABLED = !!(
  GOOGLE_OAUTH_CLIENT_ID &&
  GOOGLE_OAUTH_CLIENT_SECRET &&
  GOOGLE_OAUTH_REFRESH_TOKEN
);

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CHUNK_RETRY_ATTEMPTS = 3;
const PILEUP_THRESHOLD = 5; // utterances no mesmo timestamp = alucinação

if (!S3_ENDPOINT || !S3_KEY_ID || !S3_KEY_SECRET || !OPENROUTER_API_KEY) {
  console.error(
    'Faltam variáveis de ambiente: S3_ENDPOINT, S3_KEY_ID, S3_KEY_SECRET, OPENROUTER_API_KEY',
  );
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

// Timestamp dos logs no horário de São Paulo. Usa toLocaleString com timeZone
// explícito (ICU embutido no Node) — funciona sem tzdata no container.
const log = (...args: unknown[]) =>
  console.log(new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }), ...args);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

class NonRetryableChunkError extends Error {}

// --------------------------- ffmpeg helpers ---------------------------
function runProcess(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${cmd} saiu com código ${code}: ${stderr.slice(0, 500)}`)),
    );
  });
}

async function extractAudio(videoPath: string, audioPath: string) {
  await runProcess('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', videoPath,
    '-vn', '-ac', '1', '-ar', '16000',
    '-c:a', 'libmp3lame', '-b:a', '64k',
    audioPath,
  ]);
}

async function getAudioDuration(audioPath: string): Promise<number> {
  const out = await runProcess('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ]);
  return parseFloat(out.trim());
}

async function splitAudio(
  audioPath: string,
  chunkDir: string,
  chunkSeconds: number,
): Promise<Array<{ path: string; offset: number }>> {
  const duration = await getAudioDuration(audioPath);
  const chunks: Array<{ path: string; offset: number }> = [];
  let offset = 0;
  let idx = 0;
  while (offset < duration) {
    const outPath = path.join(chunkDir, `chunk_${String(idx).padStart(3, '0')}.mp3`);
    await runProcess('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-ss', String(offset),
      '-t', String(chunkSeconds),
      '-i', audioPath,
      '-c', 'copy',
      outPath,
    ]);
    chunks.push({ path: outPath, offset });
    offset += chunkSeconds;
    idx += 1;
  }
  log(`dividido em ${chunks.length} chunk(s)`);
  return chunks;
}

// --------------------------- OpenRouter ---------------------------
function buildPrompt(participants: string[]): string {
  const speakerSection = participants.length
    ? `Os participantes desta reunião são: ${participants.join(', ')}. ` +
      `Use o NOME EXATO de um deles quando conseguir identificar pela voz/contexto; ` +
      `se não conseguir, use "Pessoa 1", "Pessoa 2", etc, mantendo consistência.`
    : `Se houver vozes distintas, use "Pessoa 1", "Pessoa 2", etc, mantendo consistência.`;
  return `Você é um transcritor de áudio. Vai receber um áudio de uma reunião empresarial em português brasileiro.

REGRAS ABSOLUTAS - TRANSCRIÇÃO LITERAL:
- Transcreva EXATAMENTE o que foi dito. Palavra por palavra.
- NÃO invente conteúdo. Se não houver fala num trecho, NÃO gere utterance.
- NÃO parafraseie. NÃO resuma. NÃO complete frases inacabadas.
- NÃO corrija gramática nem fluência - preserve gaguejos, "é, é", "tipo assim", etc.
- NÃO traduza. Mantenha o português brasileiro como falado.
- Se houver silêncio ou ruído sem fala, retorne lista vazia em vez de inventar.

Divisão em utterances:
- Cada utterance = 1-2 frases curtas de UM speaker.
- Quando o speaker muda, nova utterance.

REGRAS CRÍTICAS sobre timestamps:
- "start" DEVE ser estritamente crescente entre utterances consecutivas.
- NUNCA repita o mesmo timestamp em utterances diferentes.
- "end" DEVE ser >= "start" da própria utterance e <= "start" da próxima.
- Timestamps em segundos relativos ao início DESTE áudio (começa em 0).

Para o campo "speaker":
${speakerSection}
- Se for só uma voz, mantenha sempre o mesmo speaker.

Retorne APENAS um objeto JSON no formato:
{"utterances": [{"speaker": "...", "text": "...", "start": 0.0, "end": 2.5}, ...]}

Se o áudio estiver mudo, com ruído sem fala ou sem conteúdo transcrevível, retorne {"utterances": []}.`;
}

const TRANSCRIPTION_SCHEMA = {
  type: 'object',
  properties: {
    utterances: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string' },
          text: { type: 'string' },
          start: { type: 'number' },
          end: { type: 'number' },
        },
        required: ['speaker', 'text', 'start', 'end'],
        additionalProperties: false,
      },
    },
  },
  required: ['utterances'],
  additionalProperties: false,
} as const;

function parseTranscriptionContent(content: unknown): { utterances?: unknown[] } {
  if (typeof content !== 'string') {
    return (content as { utterances?: unknown[] }) ?? {};
  }
  const s = content.trim();
  const tryParse = (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  let parsed = tryParse(s);
  if (parsed) return parsed;
  const block = s.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (block) {
    parsed = tryParse(block[1]);
    if (parsed) return parsed;
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    parsed = tryParse(s.slice(first, last + 1));
    if (parsed) return parsed;
  }
  throw new Error(`não foi possível parsear a transcrição; início: ${s.slice(0, 200)}`);
}

// Detecta texto em loop ("é, é, é..." / "é um, é um..."): pouca variedade de
// palavras indica alucinação do modelo, não fala real.
function isRepetitiveText(text: string): boolean {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 20) return false;
  const unique = new Set(words.map((w) => w.replace(/[.,!?;:]+$/g, '')));
  return unique.size / words.length < 0.15;
}

async function transcribeChunkOnce(audioB64: string, participants: string[]): Promise<unknown[]> {
  const body = {
    model: OPENROUTER_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(participants) },
          { type: 'input_audio', input_audio: { data: audioB64, format: 'mp3' } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'transcription', strict: true, schema: TRANSCRIPTION_SCHEMA },
    },
    temperature: 0,
    max_tokens: 8192,
    reasoning: { exclude: true },
  };
  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://meet.legacyexecutoria.com.br',
      'X-Title': 'Legacy Meet - Transcription Worker',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`openrouter ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  }
  const data: any = await resp.json();
  const usage = data.usage ?? {};
  const completionTokens = Number(usage.completion_tokens ?? 0);
  const choice = data.choices?.[0] ?? {};
  const finishReason = choice.finish_reason;
  log(
    `openrouter usage prompt=${usage.prompt_tokens} completion=${completionTokens} finish=${finishReason}`,
  );

  // Resposta curta NÃO é erro: `{"utterances":[]}` é o modelo dizendo "sem fala
  // aqui" (silêncio), resultado válido. Deixamos o parse decidir — se for ilegível,
  // o catch do parse trata; se for vazio, aceitamos como chunk sem fala.
  if (finishReason === 'length') {
    throw new NonRetryableChunkError(
      `saída truncada no max_tokens (finish=length) - provável alucinação/loop, descartando`,
    );
  }
  const content = choice.message?.content;
  if (content == null) {
    throw new Error(`openrouter sem content. raw: ${JSON.stringify(data).slice(0, 400)}`);
  }
  let parsed: { utterances?: unknown[] };
  try {
    parsed = parseTranscriptionContent(content);
  } catch (e) {
    // Conteúdo ilegível costuma ser alucinação/repetição; reprocessar o mesmo
    // áudio repete o erro. Não insiste (poupa retries e créditos).
    throw new NonRetryableChunkError(e instanceof Error ? e.message : 'conteúdo ilegível');
  }
  const raw = (parsed.utterances ?? []) as Array<Record<string, unknown>>;

  // Descarta utterances em loop ("é, é, é..."): alucinação, não fala real.
  const utterances = raw.filter((u) => !isRepetitiveText(String(u.text ?? '')));
  if (raw.length && !utterances.length) {
    throw new NonRetryableChunkError('todas as utterances eram repetição (alucinação)');
  }

  // Detecta "pile-up": muitas utterances com o mesmo start (alucinação massiva).
  const counts = new Map<number, number>();
  for (const u of utterances) {
    const k = Math.round(Number(u.start ?? 0) * 100) / 100;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const maxPileup = counts.size ? Math.max(...counts.values()) : 0;
  if (maxPileup >= PILEUP_THRESHOLD) {
    throw new NonRetryableChunkError(
      `pile-up de timestamps (${maxPileup} no mesmo start) - descartando chunk`,
    );
  }
  return utterances;
}

async function transcribeChunk(chunkPath: string, participants: string[]): Promise<unknown[]> {
  const audioB64 = (await readFile(chunkPath)).toString('base64');
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CHUNK_RETRY_ATTEMPTS; attempt++) {
    try {
      return await transcribeChunkOnce(audioB64, participants);
    } catch (e) {
      if (e instanceof NonRetryableChunkError) throw e;
      lastErr = e;
      if (attempt < CHUNK_RETRY_ATTEMPTS) {
        log(`tentativa ${attempt}/${CHUNK_RETRY_ATTEMPTS} falhou: ${e} - retry em 5s`);
        await sleep(5000);
      }
    }
  }
  throw lastErr;
}

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

async function manifestExists(id: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: manifestKey(id) }));
    return true;
  } catch {
    return false;
  }
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

// --------------------------- Google Drive ---------------------------
async function getDriveAccessToken(): Promise<string> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  const data: any = await resp.json();
  if (!data.access_token) throw new Error(`drive_auth_failed: ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token;
}

/** Cria uma pasta no Drive e devolve o folderId. */
async function driveCreateFolder(token: string, name: string, parentId?: string): Promise<string> {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) metadata.parents = [parentId];
  const resp = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!resp.ok) {
    throw new Error(`drive_folder_failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data: any = await resp.json();
  if (!data.id) throw new Error('drive_folder_no_id');
  return data.id;
}

/** Faz upload resumível de um arquivo para o Drive e devolve o fileId. */
async function driveUploadFile(
  token: string,
  filePath: string,
  name: string,
  mimeType: string,
  parentId?: string,
): Promise<string> {
  const metadata: Record<string, unknown> = { name };
  if (parentId) metadata.parents = [parentId];

  const initResp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!initResp.ok) {
    throw new Error(`drive_init_failed ${initResp.status}: ${(await initResp.text()).slice(0, 300)}`);
  }
  const sessionUri = initResp.headers.get('location');
  if (!sessionUri) throw new Error('drive_init_no_session_uri');

  const fileBuffer = await readFile(filePath);
  const putResp = await fetch(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType, 'Content-Length': String(fileBuffer.length) },
    body: fileBuffer,
  });
  if (!putResp.ok) {
    throw new Error(`drive_upload_failed ${putResp.status}: ${(await putResp.text()).slice(0, 300)}`);
  }
  const result: any = await putResp.json();
  if (!result.id) throw new Error(`drive_upload_no_id: ${JSON.stringify(result).slice(0, 300)}`);
  return result.id;
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

// --------------------------- Processamento ---------------------------
function utterancesToPlainText(utts: Utterance[]): string {
  return utts.map((u) => `[${u.start.toFixed(1)}s] ${u.speaker}: ${u.text}`).join('\n');
}

async function processRecording(rec: RecordingObject) {
  const key = rec.key;
  const id = recordingIdFromKey(key);
  const roomName = id.split('__')[0];
  // Início da reunião (do nome do arquivo). Cai no lastModified só se o id não
  // tiver o stamp esperado.
  const createdAt = (startTimeFromId(id) ?? rec.lastModified ?? new Date()).toISOString();
  log(`processando ${key} (id=${id})`);

  const tmp = await mkdtemp(path.join(tmpdir(), 'transcribe-'));
  try {
    const videoPath = path.join(tmp, 'recording.mp4');
    const audioPath = path.join(tmp, 'audio.mp3');
    const chunkDir = path.join(tmp, 'chunks');
    await mkdir(chunkDir, { recursive: true });

    const meta = await getMeta(roomName);
    const participants = meta?.participants?.length
      ? meta.participants
      : meta?.host
        ? [meta.host]
        : [];
    const title = (meta?.title || '').trim();
    if (participants.length) log(`participantes: ${participants.join(', ')}`);

    await downloadToFile(key, videoPath);
    await extractAudio(videoPath, audioPath);
    const durationSeconds = Math.round(await getAudioDuration(audioPath));
    const chunks = await splitAudio(audioPath, chunkDir, CHUNK_SECONDS);

    const allUtts: Utterance[] = [];
    const skipped: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const { path: chunkPath, offset } = chunks[i];
      log(`chunk ${i + 1}/${chunks.length} (offset=${offset}s)`);
      let utts: unknown[];
      try {
        utts = await transcribeChunk(chunkPath, participants);
      } catch (e) {
        // Pula o chunk em QUALQUER falha (alucinação, parse, rede). Nunca derruba
        // a gravação inteira — assim sempre escrevemos um manifesto ao final e o
        // worker não reprocessa o mesmo arquivo para sempre.
        log(`chunk ${i + 1} pulado: ${e instanceof Error ? e.message : String(e)}`);
        skipped.push(i + 1);
        continue;
      }
      for (const raw of utts as Array<Record<string, unknown>>) {
        const text = String(raw.text ?? '').trim();
        if (!text) continue;
        const start = Number(raw.start ?? 0) + offset;
        const end = Number(raw.end ?? start) + offset;
        const speaker = String(raw.speaker ?? 'Pessoa 1').trim();
        allUtts.push({ speaker, text, start, end });
      }
    }

    // Se TODOS os chunks falharam (alucinação/length), NÃO relança erro — senão o
    // worker reprocessaria a mesma gravação pra sempre, queimando créditos. Em vez
    // disso, finaliza marcando como "failed" e mantém o vídeo no MinIO p/ reprocesso.
    const transcriptionFailed = allUtts.length === 0 && skipped.length > 0;
    if (transcriptionFailed) {
      log(
        `transcrição falhou (chunks pulados: ${skipped.join(', ')}) — finalizando sem novas tentativas, vídeo mantido no MinIO`,
      );
    }

    // Texto corrido para download (mantido no MinIO como referência do manifesto)
    const plainText = utterancesToPlainText(allUtts);
    await uploadText(transcriptKey(id, 'txt'), plainText, 'text/plain; charset=utf-8');

    // Arquivamento: só move pro Drive se a transcrição deu certo (senão mantém no
    // MinIO para permitir reprocessar). Cria uma pasta por reunião no Drive.
    let storage: 's3' | 'gdrive' = 's3';
    let gdriveFileId: string | null = null;
    let gdriveFolderId: string | null = null;
    let videoKey: string | null = key;
    if (DRIVE_ENABLED && !transcriptionFailed) {
      const token = await getDriveAccessToken();
      const folderName = `${formatDateTimeBR(createdAt)} - ${title || roomName}`;
      log(`arquivando no Google Drive em "${folderName}"`);
      gdriveFolderId = await driveCreateFolder(token, folderName, GOOGLE_DRIVE_FOLDER_ID);
      gdriveFileId = await driveUploadFile(token, videoPath, `${id}.mp4`, 'video/mp4', gdriveFolderId);
      const txtPath = path.join(tmp, 'transcricao.txt');
      await writeFile(txtPath, plainText, 'utf-8');
      await driveUploadFile(token, txtPath, `${id}.txt`, 'text/plain', gdriveFolderId);
      await deleteObject(key);
      storage = 'gdrive';
      videoKey = null;
      log(`arquivado no Drive (pasta=${gdriveFolderId}, vídeo=${gdriveFileId}) e removido do MinIO`);
    }

    const manifest = {
      id,
      title,
      roomName,
      createdAt,
      durationSeconds,
      storage,
      videoKey,
      gdriveFileId,
      gdriveFolderId,
      transcriptTxtKey: transcriptKey(id, 'txt'),
      transcriptionStatus: transcriptionFailed ? ('failed' as const) : ('complete' as const),
      model: OPENROUTER_MODEL,
      participants,
      skippedChunks: skipped,
      utterances: allUtts,
    };
    await uploadText(manifestKey(id), JSON.stringify(manifest, null, 2), 'application/json');

    log(
      `concluído ${id} — ${allUtts.length} utterances, storage=${storage}${
        skipped.length ? ` (chunks pulados: ${skipped.join(', ')})` : ''
      }`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function main() {
  log(
    `worker de transcrição iniciado — modelo=${OPENROUTER_MODEL} bucket=${S3_BUCKET} ` +
      `prefixo=${SOURCE_PREFIX} poll=${POLL_INTERVAL_SECONDS}s chunk=${CHUNK_SECONDS}s ` +
      `drive=${DRIVE_ENABLED ? 'on' : 'off'}`,
  );
  while (!shuttingDown) {
    try {
      const recordings = await listPendingRecordings();
      let processedAny = false;
      for (const rec of recordings) {
        if (shuttingDown) break;
        if (await manifestExists(recordingIdFromKey(rec.key))) continue;
        processedAny = true;
        try {
          await processRecording(rec);
        } catch (e) {
          log(`falha ao processar ${rec.key}: ${e}`);
        }
      }
      if (!processedAny) await sleep(POLL_INTERVAL_SECONDS * 1000);
    } catch (e) {
      log(`erro no loop: ${e} - aguardando e tentando de novo`);
      await sleep(POLL_INTERVAL_SECONDS * 1000);
    }
  }
  log('worker encerrando');
}

void main();
