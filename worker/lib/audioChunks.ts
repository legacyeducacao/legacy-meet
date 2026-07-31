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
