export interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export function utterancesToPlainText(utts: Utterance[]): string {
  return utts.map((u) => `[${u.start.toFixed(1)}s] ${u.speaker}: ${u.text}`).join('\n');
}

// Inverte utterancesToPlainText. Cada linha: "[<start>s] <speaker>: <text>".
// O txt só guarda start; end é reconstruído como o start da fala seguinte
// (na última, end = start). Linhas fora do padrão são ignoradas.
export function parsePlainTextToUtterances(txt: string): Utterance[] {
  const out: Utterance[] = [];
  for (const line of txt.split('\n')) {
    const m = line.match(/^\[(\d+(?:\.\d+)?)s\]\s+([^:]+):\s+([\s\S]*)$/);
    if (!m) continue;
    const start = parseFloat(m[1]);
    out.push({ start, end: start, speaker: m[2].trim(), text: m[3].trim() });
  }
  for (let i = 0; i < out.length - 1; i++) out[i].end = out[i + 1].start;
  return out;
}
