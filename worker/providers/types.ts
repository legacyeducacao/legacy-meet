import type { Utterance } from '../lib/text';

export type ProviderName = 'gemini' | 'assemblyai';

/**
 * Acesso ao áudio da gravação. Cada provider escolhe o caminho: a AssemblyAI
 * baixa por URL assinada; o Gemini precisa do arquivo local (ffmpeg + chunks).
 * Preparado para o futuro com uma faixa por participante: `TranscriptionInput`
 * pode carregar várias fontes e o provider mescla por timestamp.
 */
export interface AudioSource {
  /** Rótulo da fonte (hoje sempre 'mix'; no futuro, o nome do participante). */
  label: string;
  /** URL temporária acessível de fora (MinIO assinado). */
  signedUrl(): Promise<string>;
  /** Baixa o arquivo para o caminho local informado. */
  downloadTo(destPath: string): Promise<void>;
}

export interface TranscriptionInput {
  id: string;
  roomName: string;
  /** Participantes conhecidos da reunião (nomes já canonicalizados). */
  participants: string[];
  /** Diretório temporário exclusivo deste processamento. */
  tmpDir: string;
  sources: AudioSource[];
}

export interface SkippedChunk {
  chunk: number;
  offsetSeconds: number;
  reason: string;
}

export interface TranscriptionResult {
  /** Falas em SEGUNDOS, com rótulos crus do provider (nomes, "A"/"B", …). */
  utterances: Utterance[];
  durationSeconds: number;
  /** Modelo de fala usado (ex.: google/gemini-2.5-flash, universal-3-5-pro). */
  model: string;
  providerTranscriptId?: string;
  audioDurationSeconds?: number;
  estimatedCostUsd?: number;
  skippedChunks: number[];
  skippedChunkDetails: SkippedChunk[];
  /** Diagnósticos livres gravados no manifesto (speechSeconds, silentChunks…). */
  diagnostics: Record<string, number | string | boolean>;
}

/** Job assíncrono aguardando o provider (persistido em asr-jobs/<id>.json). */
export interface PendingJob {
  recordingId: string;
  jobId: string;
  submittedAt: string;
  lastCheckedAt: string | null;
  checks: number;
}

export type TranscriptionOutcome =
  | { kind: 'completed'; result: TranscriptionResult }
  | { kind: 'pending'; jobId: string; checked?: boolean }
  | { kind: 'error'; reason: string; retryable: boolean };

export interface TranscriptionProvider {
  readonly name: ProviderName;
  /** Inicia a transcrição. Síncrono (Gemini) devolve `completed`; assíncrono, `pending`. */
  submit(input: TranscriptionInput): Promise<TranscriptionOutcome>;
  /**
   * Consulta um job pendente. `hint.doneMarker` indica que o webhook já avisou
   * que terminou (evita esperar o backoff do polling).
   */
  poll(job: PendingJob, hint: { doneMarker: boolean }): Promise<TranscriptionOutcome>;
}
