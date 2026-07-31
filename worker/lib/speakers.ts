import type { Utterance } from './text';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// Mapeia o rótulo devolvido pelo modelo para o nome real mais próximo da lista
// de participantes. Conservador de propósito: na dúvida, mantém o rótulo em vez
// de arriscar trocar a pessoa.
export function matchSpeaker(label: string, participants: string[]): string {
  const l = norm(label);
  if (!l || l.length < 3) return label;
  for (const p of participants) if (norm(p) === l) return p;
  for (const p of participants) {
    const first = norm(p).split(/\s+/)[0];
    if (first.length >= 3 && (l === first || l.startsWith(`${first} `))) return p;
  }
  return label;
}

const MERGE_GAP_SECONDS = 1.5;

// Ordena, corrige timestamps invertidos, casa rótulos com os nomes reais e
// funde falas consecutivas do mesmo speaker (o modelo fragmenta demais).
export function normalizeUtterances(utts: Utterance[], participants: string[]): Utterance[] {
  const mapped = utts
    .map((u) => ({
      ...u,
      speaker: participants.length ? matchSpeaker(u.speaker, participants) : u.speaker,
    }))
    .sort((a, b) => a.start - b.start)
    .map((u) => ({ ...u, end: Math.max(u.end, u.start) }));
  const out: Utterance[] = [];
  for (const u of mapped) {
    const last = out[out.length - 1];
    if (last && last.speaker === u.speaker && u.start - last.end <= MERGE_GAP_SECONDS) {
      last.text = `${last.text} ${u.text}`.trim();
      last.end = Math.max(last.end, u.end);
    } else {
      out.push({ ...u });
    }
  }
  return out;
}
