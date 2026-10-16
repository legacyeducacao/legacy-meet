/**
 * Gravação "zumbi": a reunião acaba, mas alguém esquece a aba aberta e a sala
 * (e o egress) continua gravando horas de silêncio — caso real de 22h39min que
 * a AssemblyAI recusou ("Audio duration is too long") e a reunião ficou sem
 * transcrição. Antes de transcrever, o worker corta o silêncio do fim.
 */
import { parseSilences, speechSegments, type Silence } from './audioChunks';
import { runProcess, runProcessAll } from './ffmpeg';

export interface TrimOptions {
  /** Abaixo desta duração nada é analisado (reunião normal, custo zero). */
  thresholdSeconds: number;
  /** Teto absoluto do que segue para transcrição/arquivamento. */
  maxSeconds: number;
  /** Margem mantida depois da última fala. */
  tailPadSeconds: number;
  /** Trechos "não silenciosos" menores que isto são estalos/ruído, não fala. */
  minSpeechSeconds: number;
}

/** Ponto de corte em segundos, ou null quando a gravação fica inteira. */
export function planTrim(durationSeconds: number, silences: Silence[], opts: TrimOptions): number | null {
  if (!(durationSeconds > opts.thresholdSeconds)) return null;
  const speech = speechSegments(durationSeconds, silences).filter(
    (s) => s.end - s.start >= opts.minSpeechSeconds,
  );
  const lastSpeechEnd = speech.length ? Math.max(...speech.map((s) => s.end)) : 0;
  const cut = Math.min(opts.maxSeconds, lastSpeechEnd + opts.tailPadSeconds);
  return cut >= durationSeconds - 1 ? null : cut;
}

export async function probeDuration(input: string): Promise<number> {
  const out = await runProcess('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    input,
  ]);
  return parseFloat(out.trim());
}

/**
 * Silêncios do áudio inteiro. Aceita URL (o ffmpeg lê em streaming, sem
 * gravar o vídeo em disco). Janela mínima de 2s: só interessa achar o
 * silêncio longo do fim, e o log fica pequeno mesmo em 20h+ de áudio.
 */
export async function detectSilences(input: string, noiseDb: number, minSeconds = 2): Promise<Silence[]> {
  const out = await runProcessAll('ffmpeg', [
    '-hide_banner', '-nostats',
    '-i', input,
    '-vn', '-af', `silencedetect=n=${noiseDb}dB:d=${minSeconds}`,
    '-f', 'null', '-',
  ]);
  return parseSilences(out);
}

/** Recorta [0, seconds] sem recodificar (rápido; vídeo e áudio intactos). */
export async function trimMedia(input: string, output: string, seconds: number): Promise<void> {
  await runProcess('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', input,
    '-t', seconds.toFixed(3),
    '-c', 'copy',
    '-movflags', '+faststart',
    output,
  ]);
}
