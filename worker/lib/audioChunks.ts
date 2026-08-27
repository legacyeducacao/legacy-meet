export interface Silence {
  start: number;
  end: number;
}

// Parseia o log do ffmpeg `silencedetect` (vem no stderr).
export function parseSilences(log: string): Silence[] {
  const out: Silence[] = [];
  let pending: number | null = null;
  const re = /silence_(start|end):\s*(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log))) {
    const v = parseFloat(m[2]);
    if (m[1] === 'start') pending = v;
    else if (pending != null) {
      out.push({ start: pending, end: v });
      pending = null;
    }
  }
  return out;
}

// Pontos de corte a cada ~targetSeconds, puxados para o meio do silêncio mais
// próximo dentro de [alvo-windowSeconds, alvo]. Cortar no meio de uma frase
// confunde a identificação do speaker na fronteira do chunk — silêncio é o
// lugar seguro para cortar.
export function computeChunkBoundaries(
  duration: number,
  silences: Silence[],
  targetSeconds: number,
  windowSeconds: number,
): number[] {
  const cuts: number[] = [];
  let prev = 0;
  while (duration - prev > targetSeconds) {
    const target = prev + targetSeconds;
    let cut = target;
    let best = Infinity;
    for (const s of silences) {
      const mid = (s.start + s.end) / 2;
      if (mid <= prev + 1) continue;
      if (mid < target - windowSeconds || mid > target) continue;
      const d = target - mid;
      if (d < best) {
        best = d;
        cut = mid;
      }
    }
    cuts.push(cut);
    prev = cut;
  }
  return cuts;
}

export interface Segment {
  start: number;
  end: number;
}

// Mapa de FALA: complemento dos silêncios (detectados por dB) dentro da
// duração do áudio. Base do guardrail anti-alucinação — o que o modelo
// "transcrever" fora destes trechos não veio do áudio.
export function speechSegments(duration: number, silences: Silence[]): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, s.start);
    const end = Math.min(duration, s.end);
    if (start > cursor) out.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < duration) out.push({ start: cursor, end: duration });
  return out;
}

// Segundos do intervalo [start, end] que caem dentro de trechos de fala.
export function speechOverlap(start: number, end: number, segments: Segment[]): number {
  let total = 0;
  for (const seg of segments) {
    const a = Math.max(start, seg.start);
    const b = Math.min(end, seg.end);
    if (b > a) total += b - a;
  }
  return total;
}
