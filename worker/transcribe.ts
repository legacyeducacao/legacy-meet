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
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
import { parsePlainTextToUtterances, utterancesToPlainText, type Utterance } from './lib/text';
import { computeChunkBoundaries, parseSilences, type Silence } from './lib/audioChunks';
import { fetchWithTimeout } from './lib/http';
import {
  driveFindFileInFolder,
  driveFindOrCreateFolder,
  driveUploadFile,
  getDriveAccessToken,
  type DriveConfig,
} from './lib/drive';

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
const OPENROUTER_TIMEOUT_MS = Number(env.OPENROUTER_TIMEOUT_MS ?? '180000');
const CHUNK_SECONDS = Number(env.CHUNK_SECONDS ?? '300');
const SOURCE_PREFIX = env.SOURCE_PREFIX ?? 'com-transcricao/';
const OUTPUT_PREFIX = env.OUTPUT_PREFIX ?? 'transcricoes/';
const MANIFEST_PREFIX = env.MANIFEST_PREFIX ?? 'manifests/';

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

// Como runProcess, mas resolve stdout+stderr (o ffmpeg loga o silencedetect no stderr).
function runProcessAll(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(`${stdout}\n${stderr}`)
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

async function detectSilences(audioPath: string): Promise<Silence[]> {
  try {
    const out = await runProcessAll('ffmpeg', [
      '-i', audioPath,
      '-af', 'silencedetect=noise=-35dB:d=0.5',
      '-f', 'null', '-',
    ]);
    return parseSilences(out);
  } catch (e) {
    log(`silencedetect falhou (${e}) — usando cortes fixos`);
    return [];
  }
}

async function splitAudio(
  audioPath: string,
  chunkDir: string,
  chunkSeconds: number,
): Promise<Array<{ path: string; offset: number }>> {
  const duration = await getAudioDuration(audioPath);
  // Cortes alinhados a pausas de silêncio: cortar no meio de uma frase confundia
  // o speaker na fronteira entre chunks.
  const silences = await detectSilences(audioPath);
  const cuts = computeChunkBoundaries(duration, silences, chunkSeconds, 60);
  const starts = [0, ...cuts];
  const chunks: Array<{ path: string; offset: number }> = [];
  for (let idx = 0; idx < starts.length; idx++) {
    const offset = starts[idx];
    const len = (idx + 1 < starts.length ? starts[idx + 1] : duration) - offset;
    const outPath = path.join(chunkDir, `chunk_${String(idx).padStart(3, '0')}.mp3`);
    // RE-ENCODE (não -c copy): cortar o MP3 no meio do stream com copy gera chunks
    // desalinhados/sem header que o decoder do modelo lê como ruído → ele alucina
    // ou devolve vazio e o chunk é descartado (buracos na transcrição). Re-encodar
    // a partir do áudio íntegro garante um MP3 limpo e decodável. -ss antes do -i
    // = seek rápido; re-encode = chunk válido.
    await runProcess('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-ss', String(offset),
      '-i', audioPath,
      '-t', String(len),
      '-ac', '1', '-ar', '16000',
      '-c:a', 'libmp3lame', '-b:a', '64k',
      outPath,
    ]);
    const { size } = await stat(outPath);
    log(`  chunk ${idx} offset=${offset.toFixed(1)}s dur=${len.toFixed(1)}s tamanho=${(size / 1024).toFixed(0)}KB`);
    chunks.push({ path: outPath, offset });
  }
  log(`dividido em ${chunks.length} chunk(s)`);
  return chunks;
}

// --------------------------- OpenRouter ---------------------------
function buildPrompt(participants: string[], prevTail: Utterance[] = []): string {
  const speakerSection = participants.length
    ? `Os participantes desta reunião são EXATAMENTE: ${participants.join(', ')}.
- Use SEMPRE o nome exato de um deles no campo "speaker".
- Só use "Desconhecido" quando realmente não conseguir atribuir a fala a nenhum deles.
- NUNCA invente outros nomes nem rótulos como "Pessoa 1".`
    : `Se houver vozes distintas, use "Pessoa 1", "Pessoa 2", etc, mantendo consistência dentro deste áudio.`;
  // Cauda do chunk anterior: sem isso cada chunk era uma chamada sem memória e
  // os rótulos de speaker não tinham relação entre chunks.
  const contextSection = prevTail.length
    ? `\nCONTEXTO (NÃO transcrever — apenas referência): este áudio é a CONTINUAÇÃO da mesma reunião. Últimas falas do trecho anterior:\n${prevTail
        .map((u) => `${u.speaker}: ${u.text}`)
        .join('\n')}\nUse os MESMOS rótulos de speaker para as mesmas vozes.\n`
    : '';
  return `Você é um transcritor de áudio. Vai receber um áudio de uma reunião empresarial em português brasileiro.
${contextSection}
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

// Com participantes conhecidos, `speaker` vira enum (nomes + "Desconhecido"):
// o modelo fica IMPEDIDO de inventar rótulos novos ("Pessoa 3", nomes errados).
function buildTranscriptionSchema(participants: string[]) {
  const speaker = participants.length
    ? { type: 'string', enum: [...participants, 'Desconhecido'] }
    : { type: 'string' };
  return {
    type: 'object',
    properties: {
      utterances: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            speaker,
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
  };
}

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
  // SALVAMENTO: quando o JSON vem truncado (finish=length em chunk denso) ou
  // levemente malformado, extrai os objetos de utterance completos que der, em
  // vez de jogar o chunk inteiro fora. Recupera quase tudo de trechos densos.
  const salvaged: unknown[] = [];
  const re = /\{[^{}]*\}/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(s))) {
    const o = tryParse(mm[0]);
    if (o && typeof (o as { text?: unknown }).text === 'string') salvaged.push(o);
  }
  if (salvaged.length) return { utterances: salvaged };
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

async function transcribeChunkOnce(
  audioB64: string,
  participants: string[],
  prevTail: Utterance[],
): Promise<unknown[]> {
  const body = {
    model: OPENROUTER_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(participants, prevTail) },
          { type: 'input_audio', input_audio: { data: audioB64, format: 'mp3' } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'transcription',
        strict: true,
        schema: buildTranscriptionSchema(participants),
      },
    },
    temperature: 0,
    // Alto o suficiente para um chunk denso de 5 min caber sem truncar (antes
    // 8192 cortava trechos com muita fala). Se ainda truncar, o salvamento no
    // parse recupera as utterances completas.
    max_tokens: 16384,
    reasoning: { exclude: true },
  };
  const resp = await fetchWithTimeout(
    OPENROUTER_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://meet.legacyexecutoria.com.br',
        'X-Title': 'Legacy Meet - Transcription Worker',
      },
      body: JSON.stringify(body),
    },
    OPENROUTER_TIMEOUT_MS,
  );
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
  // finish=length NÃO é mais descarte automático: na maioria das vezes é um
  // trecho DENSO de conversa cuja transcrição passou do max_tokens (não é
  // alucinação). Seguimos para parsear/salvar o que veio; alucinação real
  // (repetição) é barrada pelo filtro isRepetitiveText/pile-up abaixo.
  if (finishReason === 'length') {
    log(`chunk truncado no max_tokens (finish=length) - salvando o que foi transcrito`);
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

async function transcribeChunk(
  chunkPath: string,
  participants: string[],
  prevTail: Utterance[],
): Promise<unknown[]> {
  const audioB64 = (await readFile(chunkPath)).toString('base64');
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CHUNK_RETRY_ATTEMPTS; attempt++) {
    try {
      return await transcribeChunkOnce(audioB64, participants, prevTail);
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

async function getObjectTextOrNull(key: string): Promise<string | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return await (res.Body as any).transformToString();
  } catch {
    return null;
  }
}

async function listManifestIds(): Promise<string[]> {
  const ids: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: MANIFEST_PREFIX, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Key.endsWith('.json')) {
        ids.push(obj.Key.slice(MANIFEST_PREFIX.length).replace(/\.json$/, ''));
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return ids;
}

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

    // Reuso de backlog: se já existe transcrição (txt) no MinIO de um run
    // anterior, reconstrói as falas dela em vez de re-transcrever (economiza
    // créditos). Gravação nova não tem txt → transcreve normalmente.
    const existingTxt = await getObjectTextOrNull(transcriptKey(id, 'txt'));
    const allUtts: Utterance[] = [];
    const skipped: number[] = [];
    // Motivo de cada chunk pulado — fica no manifesto para debug ("por que a
    // transcrição ficou incompleta"), já que os logs somem com o tempo.
    const skippedDetails: Array<{ chunk: number; offsetSeconds: number; reason: string }> = [];

    if (existingTxt && existingTxt.trim()) {
      const reused = parsePlainTextToUtterances(existingTxt);
      allUtts.push(...reused);
      log(`reaproveitando transcrição existente do MinIO — ${reused.length} utterance(s)`);
    } else {
      // Cauda do chunk anterior enviada como contexto do próximo — mantém os
      // rótulos de speaker consistentes ao longo da reunião inteira.
      let prevTail: Utterance[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const { path: chunkPath, offset } = chunks[i];
        log(`chunk ${i + 1}/${chunks.length} (offset=${offset}s)`);
        let utts: unknown[];
        try {
          utts = await transcribeChunk(chunkPath, participants, prevTail);
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          log(`chunk ${i + 1} pulado: ${reason}`);
          skipped.push(i + 1);
          skippedDetails.push({ chunk: i + 1, offsetSeconds: offset, reason });
          continue;
        }
        let added = 0;
        const chunkUtts: Utterance[] = [];
        for (const raw of utts as Array<Record<string, unknown>>) {
          const text = String(raw.text ?? '').trim();
          if (!text) continue;
          const start = Number(raw.start ?? 0) + offset;
          const end = Number(raw.end ?? start) + offset;
          const speaker = String(raw.speaker ?? 'Desconhecido').trim();
          chunkUtts.push({ speaker, text, start, end });
          added += 1;
        }
        allUtts.push(...chunkUtts);
        if (chunkUtts.length) prevTail = chunkUtts.slice(-10);
        log(`chunk ${i + 1} → ${added} utterance(s)`);
      }
    }

    const transcriptionFailed = allUtts.length === 0 && skipped.length > 0;
    if (transcriptionFailed) {
      log(`transcrição falhou (chunks pulados: ${skipped.join(', ')}) — arquivando vídeo mesmo assim`);
    }

    // txt de referência no MinIO (regravado a partir das falas atuais).
    const plainText = utterancesToPlainText(allUtts);
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
        log(`arquivando no Google Drive em "${folderName}"`);
        const token = await getDriveAccessToken(DRIVE_CFG, DRIVE_TIMEOUT_MS);
        const res = await archiveVideoToDrive(token, videoPath, id, folderName, plainText, tmp);
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
      skippedChunkDetails: skippedDetails,
      utterances: allUtts,
    };
    await uploadText(manifestKey(id), JSON.stringify(manifest, null, 2), 'application/json');

    // Só remove o .mp4 do MinIO DEPOIS do manifesto e SÓ se foi pro Drive.
    if (storage === 'gdrive') {
      await deleteObject(key);
    }

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
