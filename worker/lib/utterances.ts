import type { Utterance } from './text';

/** Utterance como a AssemblyAI devolve (timestamps em milissegundos). */
export interface AssemblyUtterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

// Converte para o formato interno (segundos), ordenado por início, sem falas
// vazias e com end >= start. O rótulo (A, B, C…) fica cru: o mapeamento para
// nomes reais é uma etapa separada.
export function parseAssemblyUtterances(raw: AssemblyUtterance[] | undefined | null): Utterance[] {
  return (raw ?? [])
    .map((u) => {
      const start = Number(u.start ?? 0) / 1000;
      const end = Math.max(Number(u.end ?? 0) / 1000, start);
      return { speaker: String(u.speaker ?? '').trim(), text: String(u.text ?? '').trim(), start, end };
    })
    .filter((u) => u.text)
    .sort((a, b) => a.start - b.start);
}

// Nome exibido quando o rótulo não foi mapeado para um participante.
export function genericSpeakerName(label: string): string {
  return label.startsWith('Falante ') ? label : `Falante ${label}`;
}
