import type { Utterance } from './text';
// Mesma normalização da dedup de participantes — divergir aqui (ex.: espaços
// duplos) faria um nome casar na lista e não casar no rótulo.
import { norm } from './participants';

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
// Bloco fundido não passa disso: falas gigantes escondem loops do modelo e
// pioram a leitura.
const MERGE_MAX_CHARS = 600;

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Ordena, corrige timestamps invertidos, casa rótulos com os nomes reais e
// funde falas consecutivas do mesmo speaker (o modelo fragmenta demais) —
// sem duplicar falas idênticas nem criar blocos gigantes.
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
      // Fala idêntica à anterior = resquício de loop do modelo: descarta.
      if (normText(u.text) === normText(last.text)) {
        last.end = Math.max(last.end, u.end);
        continue;
      }
      if (last.text.length + u.text.length + 1 <= MERGE_MAX_CHARS) {
        last.text = `${last.text} ${u.text}`.trim();
        last.end = Math.max(last.end, u.end);
        continue;
      }
    }
    out.push({ ...u });
  }
  return out;
}
