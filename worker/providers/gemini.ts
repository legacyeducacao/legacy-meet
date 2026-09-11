/**
 * Provider "gemini": pipeline original do worker. Baixa o vídeo, extrai o áudio
 * com ffmpeg, divide em chunks cortados em silêncio e transcreve cada chunk via
 * OpenRouter (modelo multimodal, ex.: Gemini 2.5 Flash) com saída estruturada
 * (speaker + timestamps), guardrails contra alucinação e loop de repetição.
 *
 * Mantido intacto como caminho de rollback da migração para AssemblyAI
 * (TRANSCRIPTION_PROVIDER=gemini).
 */
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Utterance } from '../lib/text';
import {
  computeChunkBoundaries,
  parseSilences,
  speechOverlap,
  speechSegments,
  type Segment,
  type Silence,
} from '../lib/audioChunks';
import { collapseRepetitions } from '../lib/repetition';
import { fetchWithTimeout } from '../lib/http';
import { extractAudio, getAudioDuration, runProcess, runProcessAll } from '../lib/ffmpeg';
import { log, sleep } from '../lib/log';
import type {
  SkippedChunk,
  TranscriptionInput,
  TranscriptionOutcome,
  TranscriptionProvider,
} from './types';

export interface GeminiProviderConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  chunkSeconds: number;
}

const env = process.env;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CHUNK_RETRY_ATTEMPTS = 3;
const PILEUP_THRESHOLD = 5; // utterances no mesmo timestamp = alucinação

// Config do provider (preenchida em createGeminiProvider). Módulo-escopo para
// as funções abaixo continuarem idênticas ao pipeline original.
let OPENROUTER_API_KEY = '';
let OPENROUTER_MODEL = '';
let OPENROUTER_TIMEOUT_MS = 180000;
let CHUNK_SECONDS_CFG = 300;

class NonRetryableChunkError extends Error {}

// - MIN_SPEECH_SECONDS_PER_CHUNK: chunk com menos fala que isto nem vai para a IA (2 s)
// - MIN_SPEECH_RATIO: fala reportada com menos que esta fração dentro de trechos
//   de fala é descartada como alucinação (0.25); janela tolerante de ±1,5 s
//   porque os timestamps do modelo são aproximados.
const SILENCE_NOISE_DB = Number(env.SILENCE_NOISE_DB ?? '-35');
const SILENCE_MIN_SECONDS = Number(env.SILENCE_MIN_SECONDS ?? '0.5');
const MIN_SPEECH_SECONDS_PER_CHUNK = Number(env.MIN_SPEECH_SECONDS_PER_CHUNK ?? '2');
const MIN_SPEECH_RATIO = Number(env.MIN_SPEECH_RATIO ?? '0.25');
const SPEECH_PAD_SECONDS = 1.5;

async function detectSilences(audioPath: string): Promise<Silence[]> {
  try {
    const out = await runProcessAll('ffmpeg', [
      '-i', audioPath,
      '-af', `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_SECONDS}`,
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
  duration: number,
  silences: Silence[],
): Promise<Array<{ path: string; offset: number; length: number }>> {
  // Cortes alinhados a pausas de silêncio: cortar no meio de uma frase confundia
  // o speaker na fronteira entre chunks.
  const cuts = computeChunkBoundaries(duration, silences, chunkSeconds, 60);
  const starts = [0, ...cuts];
  const chunks: Array<{ path: string; offset: number; length: number }> = [];
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
    chunks.push({ path: outPath, offset, length: len });
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

// Resultado de um chunk: falas já tipadas (timestamps relativos ao chunk) e se
// o modelo entrou em loop de repetição (trecho colapsado, possivelmente
// incompleto).
interface ChunkResult {
  utterances: Utterance[];
  looped: boolean;
}

// Repetições removidas num chunk a partir das quais consideramos que o modelo
// degenerou em loop (e não apenas repetiu uma frase de verdade).
const LOOP_THRESHOLD = 5;

async function transcribeChunkOnce(
  audioB64: string,
  participants: string[],
  prevTail: Utterance[],
  temperature = 0,
): Promise<ChunkResult> {
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
    temperature,
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

  // Loop de repetição: o modelo devolve a mesma frase dezenas de vezes, em
  // falas curtas (cada uma passa no filtro acima). Colapsa para uma ocorrência;
  // muitas remoções = o chunk degenerou (o chamador refaz sem contexto).
  const typed: Utterance[] = utterances
    .map((u) => ({
      speaker: String(u.speaker ?? 'Desconhecido').trim(),
      text: String(u.text ?? '').trim(),
      start: Number(u.start ?? 0),
      end: Number(u.end ?? u.start ?? 0),
    }))
    .filter((u) => u.text);
  const { utterances: collapsed, removed } = collapseRepetitions(typed);
  if (removed > 0) log(`repetições colapsadas no chunk: ${removed}`);
  return { utterances: collapsed, looped: removed >= LOOP_THRESHOLD };
}

async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CHUNK_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
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

async function transcribeChunk(
  chunkPath: string,
  participants: string[],
  prevTail: Utterance[],
): Promise<ChunkResult> {
  const audioB64 = (await readFile(chunkPath)).toString('base64');
  const first = await withRetries(() => transcribeChunkOnce(audioB64, participants, prevTail));
  if (!first.looped) return first;

  // O loop é não-determinístico: refaz UMA vez sem o contexto do chunk anterior
  // (que pode ter primado o loop) e com um pouco de temperatura. Se voltar a
  // loopar, fica com a versão colapsada (melhor do que perder o chunk).
  log('chunk em loop de repetição — refazendo sem contexto');
  try {
    const retry = await withRetries(() => transcribeChunkOnce(audioB64, participants, [], 0.3));
    if (!retry.looped) return retry;
  } catch (e) {
    log(`retry do chunk em loop falhou (${e}) — mantendo versão colapsada`);
  }
  return first;
}

// --------------------------- Provider ---------------------------
async function transcribeRecording(input: TranscriptionInput): Promise<TranscriptionOutcome> {
  const { id, participants, tmpDir } = input;
  const source = input.sources[0];
  if (!source) return { kind: 'error', reason: 'sem fonte de áudio', retryable: false };

  const videoPath = path.join(tmpDir, 'recording.mp4');
  const audioPath = path.join(tmpDir, 'audio.mp3');
  const chunkDir = path.join(tmpDir, 'chunks');
  await mkdir(chunkDir, { recursive: true });

  await source.downloadTo(videoPath);
  await extractAudio(videoPath, audioPath);
  const duration = await getAudioDuration(audioPath);
  const durationSeconds = Math.round(duration);
  // Mapa de silêncio/fala da gravação inteira: guia os cortes dos chunks E é
  // o guardrail contra alucinação em trechos sem fala.
  const silences = await detectSilences(audioPath);
  const speech: Segment[] = speechSegments(duration, silences);
  const speechTotal = speech.reduce((acc, s) => acc + (s.end - s.start), 0);
  log(`fala detectada: ${speechTotal.toFixed(0)}s de ${durationSeconds}s (${silences.length} silêncios)`);
  const chunks = await splitAudio(audioPath, chunkDir, CHUNK_SECONDS_CFG, duration, silences);
  let silentChunks = 0;
  let droppedSilent = 0;

  const allUtts: Utterance[] = [];
  const skipped: number[] = [];
  // Motivo de cada chunk pulado — fica no manifesto para debug ("por que a
  // transcrição ficou incompleta"), já que os logs somem com o tempo.
  const skippedDetails: SkippedChunk[] = [];

  // Cauda do chunk anterior enviada como contexto do próximo — mantém os
  // rótulos de speaker consistentes ao longo da reunião inteira.
  let prevTail: Utterance[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const { path: chunkPath, offset, length } = chunks[i];
    // Chunk sem fala (só silêncio/ruído): nem vai para a IA — é onde ela
    // mais inventa conteúdo, e não custa nada pular.
    const chunkSpeech = speechOverlap(offset, offset + length, speech);
    if (chunkSpeech < MIN_SPEECH_SECONDS_PER_CHUNK) {
      silentChunks += 1;
      log(`chunk ${i + 1}/${chunks.length} sem fala (${chunkSpeech.toFixed(1)}s) — pulado`);
      continue;
    }
    log(`chunk ${i + 1}/${chunks.length} (offset=${offset}s, fala=${chunkSpeech.toFixed(0)}s)`);
    let result: ChunkResult;
    try {
      result = await transcribeChunk(chunkPath, participants, prevTail);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      log(`chunk ${i + 1} pulado: ${reason}`);
      skipped.push(i + 1);
      skippedDetails.push({ chunk: i + 1, offsetSeconds: offset, reason });
      continue;
    }
    const chunkUtts: Utterance[] = result.utterances
      .map((u) => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start + offset,
        end: Math.max(u.end, u.start) + offset,
      }))
      // Guardrail: fala "transcrita" onde o áudio estava em silêncio é
      // alucinação. Janela com folga de ±1,5s (timestamps do modelo são
      // aproximados); descarta se quase nada dela cai em trecho de fala.
      .filter((u) => {
        const a = u.start - SPEECH_PAD_SECONDS;
        const b = Math.max(u.end, u.start + 1) + SPEECH_PAD_SECONDS;
        const ratio = speechOverlap(a, b, speech) / (b - a);
        if (ratio < MIN_SPEECH_RATIO) {
          droppedSilent += 1;
          log(`  descartada (silêncio no áudio) [${u.start.toFixed(0)}s] ${u.speaker}: ${u.text.slice(0, 60)}`);
          return false;
        }
        return true;
      });
    allUtts.push(...chunkUtts);
    if (result.looped) {
      // Fica registrado como trecho possivelmente incompleto (a UI oferece
      // "Transcrever novamente") e NÃO alimenta o contexto do próximo chunk
      // — era isso que propagava o loop através da fronteira dos 5 min.
      skipped.push(i + 1);
      skippedDetails.push({
        chunk: i + 1,
        offsetSeconds: offset,
        reason: 'loop de repetição do modelo — trecho colapsado, pode estar incompleto',
      });
      prevTail = [];
    } else if (chunkUtts.length) {
      prevTail = chunkUtts.slice(-10);
    }
    log(`chunk ${i + 1} → ${chunkUtts.length} utterance(s)${result.looped ? ' (loop)' : ''}`);
  }

  log(`gemini: ${id} → ${allUtts.length} utterance(s) brutas`);
  return {
    kind: 'completed',
    result: {
      utterances: allUtts,
      durationSeconds,
      model: OPENROUTER_MODEL,
      skippedChunks: skipped,
      skippedChunkDetails: skippedDetails,
      // Diagnóstico do guardrail de silêncio.
      diagnostics: {
        speechSeconds: Math.round(speechTotal),
        silentChunks,
        droppedSilentUtterances: droppedSilent,
      },
    },
  };
}

export function createGeminiProvider(cfg: GeminiProviderConfig): TranscriptionProvider {
  OPENROUTER_API_KEY = cfg.apiKey;
  OPENROUTER_MODEL = cfg.model;
  OPENROUTER_TIMEOUT_MS = cfg.timeoutMs;
  CHUNK_SECONDS_CFG = cfg.chunkSeconds;
  return {
    name: 'gemini',
    submit: transcribeRecording,
    // O pipeline Gemini é síncrono: nunca deixa job pendente. Um job em
    // asr-jobs/ é de outro provider — devolve erro retryável para a gravação
    // voltar à fila e ser reprocessada por este caminho.
    async poll(job) {
      return {
        kind: 'error',
        reason: `job ${job.jobId} pertence a outro provider; reprocessando com gemini`,
        retryable: true,
      };
    },
  };
}
