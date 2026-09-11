/**
 * Provider "assemblyai": transcrição + diarização por ASR dedicado
 * (Universal-3.5 Pro). Assíncrono: `submit` cria a transcrição por URL
 * assinada do MinIO e devolve `pending`; `poll` consulta o status (na hora
 * quando o webhook já deixou marker, senão com backoff) e converte o
 * resultado. Rótulos de falante saem crus (A, B, C) — o mapeamento para
 * nomes reais é etapa do worker.
 */
import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AssemblyAIError,
  buildTranscriptParams,
  estimateCostUsd,
  type Transcript,
  type TranscriptParams,
} from '../lib/assemblyai';
import { extractAudio as ffmpegExtractAudio } from '../lib/ffmpeg';
import { buildKeyterms } from '../lib/keyterms';
import { log } from '../lib/log';
import { parseAssemblyUtterances } from '../lib/utterances';
import type {
  PendingJob,
  TranscriptionInput,
  TranscriptionOutcome,
  TranscriptionProvider,
} from './types';

export interface AssemblyAIClientLike {
  submit(params: TranscriptParams): Promise<Transcript>;
  get(id: string): Promise<Transcript>;
  upload(data: Buffer | Uint8Array): Promise<string>;
}

export interface AssemblyAIProviderConfig {
  client: AssemblyAIClientLike;
  speechModel: string;
  languageCode: string;
  /** Vocabulário fixo (config/keyterms.json); nomes dos participantes são somados. */
  keyterms: string[];
  /** Enviar nº de participantes como teto de falantes (speaker_options). */
  useParticipantCount: boolean;
  addons: { sentiment: boolean; entities: boolean };
  /** Sem webhook configurado o provider funciona só com polling. */
  webhook?: { baseUrl: string; headerName: string; headerValue: string };
  /** Tarifa para custo estimado; undefined = calcula pela tabela pública. */
  ratePerHourUsd?: number;
  pollMinIntervalMs: number;
  pollMaxIntervalMs: number;
  now?: () => number;
  // Injetáveis para teste (evitam ffmpeg/disco).
  extractAudio?: (videoPath: string, audioPath: string) => Promise<void>;
  readFile?: (p: string) => Promise<Buffer>;
}

export const WEBHOOK_PATH = '/api/transcription/webhook';

export function createAssemblyAIProvider(cfg: AssemblyAIProviderConfig): TranscriptionProvider {
  const now = cfg.now ?? (() => Date.now());
  const extractAudio = cfg.extractAudio ?? ffmpegExtractAudio;
  const readFile = cfg.readFile ?? ((p: string) => fsReadFile(p));

  async function resolveAudioUrl(input: TranscriptionInput): Promise<string> {
    const source = input.sources[0];
    // Primeira tentativa: URL assinada (a AssemblyAI baixa direto do MinIO; nada
    // passa pelo worker). Se a gravação já falhou antes — URL inacessível, por
    // exemplo — a retentativa baixa o vídeo, extrai o áudio e sobe pelo
    // endpoint de upload da própria AssemblyAI.
    if (input.attempt === 0) return source.signedUrl();
    const videoPath = path.join(input.tmpDir, 'recording.mp4');
    const audioPath = path.join(input.tmpDir, 'audio.mp3');
    log(`assemblyai: tentativa ${input.attempt + 1} de ${input.id} — usando upload em vez de URL`);
    await source.downloadTo(videoPath);
    await extractAudio(videoPath, audioPath);
    return cfg.client.upload(await readFile(audioPath));
  }

  async function submit(input: TranscriptionInput): Promise<TranscriptionOutcome> {
    if (!input.sources.length) return { kind: 'error', reason: 'sem fonte de áudio', retryable: false };
    let audioUrl: string;
    try {
      audioUrl = await resolveAudioUrl(input);
    } catch (e) {
      return { kind: 'error', reason: `preparar áudio: ${errMsg(e)}`, retryable: true };
    }
    const params = buildTranscriptParams({
      audioUrl,
      speechModel: cfg.speechModel,
      languageCode: cfg.languageCode,
      keyterms: buildKeyterms(cfg.keyterms, input.participants),
      maxSpeakers:
        cfg.useParticipantCount && input.participants.length ? input.participants.length : undefined,
      addons: cfg.addons,
      webhook: cfg.webhook
        ? {
            url: `${cfg.webhook.baseUrl.replace(/\/$/, '')}${WEBHOOK_PATH}?recordingId=${encodeURIComponent(input.id)}`,
            headerName: cfg.webhook.headerName,
            headerValue: cfg.webhook.headerValue,
          }
        : undefined,
    });
    try {
      const t = await cfg.client.submit(params);
      if (!t?.id) return { kind: 'error', reason: 'resposta sem id de transcrição', retryable: true };
      log(`assemblyai: ${input.id} submetida (transcript=${t.id}, status=${t.status})`);
      return { kind: 'pending', jobId: t.id };
    } catch (e) {
      // 4xx = chave, parâmetro ou URL rejeitados na hora: não adianta insistir
      // sem intervenção. Rede/5xx esgotados: vale nova tentativa no próximo ciclo.
      const definitive =
        e instanceof AssemblyAIError && e.status >= 400 && e.status < 500 && e.status !== 429;
      return { kind: 'error', reason: `submissão: ${errMsg(e)}`, retryable: !definitive };
    }
  }

  // Intervalo do polling de fallback: dobra a cada consulta até o teto. Com o
  // webhook funcionando o marker chega antes e este caminho quase não roda.
  function pollDue(job: PendingJob): boolean {
    const last = job.lastCheckedAt ? Date.parse(job.lastCheckedAt) : Date.parse(job.submittedAt);
    const interval = Math.min(cfg.pollMaxIntervalMs, cfg.pollMinIntervalMs * 2 ** Math.min(job.checks, 10));
    return now() - last >= interval;
  }

  async function poll(job: PendingJob, hint: { doneMarker: boolean }): Promise<TranscriptionOutcome> {
    if (!hint.doneMarker && !pollDue(job)) return { kind: 'pending', jobId: job.jobId, checked: false };
    const t = await cfg.client.get(job.jobId);
    if (t.status === 'queued' || t.status === 'processing') {
      return { kind: 'pending', jobId: job.jobId, checked: true };
    }
    if (t.status === 'error') {
      const reason = t.error || 'erro sem detalhe na AssemblyAI';
      // Falha ao baixar a URL assinada (MinIO inacessível de fora, URL expirada
      // na fila): retryável — a gravação volta para a fila e a próxima tentativa
      // sobe o áudio pelo endpoint de upload. Outros erros são definitivos.
      return { kind: 'error', reason, retryable: isDownloadError(reason) };
    }
    const audioSeconds = Number(t.audio_duration ?? 0);
    const utterances = parseAssemblyUtterances(t.utterances);
    const model = t.speech_model_used || cfg.speechModel;
    return {
      kind: 'completed',
      result: {
        utterances,
        rawSpeakerLabels: true,
        durationSeconds: Math.round(audioSeconds),
        model,
        providerTranscriptId: t.id,
        audioDurationSeconds: audioSeconds,
        estimatedCostUsd: estimateCostUsd(audioSeconds, {
          keyterms: cfg.keyterms.length > 0,
          sentiment: cfg.addons.sentiment,
          entities: cfg.addons.entities,
          ratePerHourUsd: cfg.ratePerHourUsd,
        }),
        skippedChunks: [],
        skippedChunkDetails: [],
        diagnostics: {
          languageCode: t.language_code ?? cfg.languageCode,
          ...(t.webhook_status_code != null ? { webhookStatusCode: t.webhook_status_code } : {}),
        },
      },
    };
  }

  return { name: 'assemblyai', submit, poll };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const isDownloadError = (reason: string) =>
  /download|unable to (fetch|retrieve|access)|audio_url|not accessible/i.test(reason);
