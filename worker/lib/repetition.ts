import type { Utterance } from './text';

// Loop de repetição do modelo: ele entra em "Aí o cara só recebia o diploma,
// não fazia nada." x46 — em dezenas de falas curtas (cada uma passa no filtro
// por utterance) ou numa fala só. Colapsa a repetição para UMA ocorrência e
// devolve quantas foram removidas (o chamador decide se o chunk "loopou").

const normSentence = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const splitSentences = (t: string) => t.split(/(?<=[.!?…])\s+/).filter((s) => s.trim());

// Só a partir de 3 repetições consecutivas: "Não. Não." é fala real.
const MIN_RUN = 3;

function collapseWithin(text: string): { text: string; removed: number } {
  const sentences = splitSentences(text);
  if (sentences.length < MIN_RUN) return { text, removed: 0 };
  const out: string[] = [];
  let removed = 0;
  let i = 0;
  while (i < sentences.length) {
    const key = normSentence(sentences[i]);
    let j = i + 1;
    while (j < sentences.length && normSentence(sentences[j]) === key) j++;
    const run = j - i;
    if (run >= MIN_RUN) {
      out.push(sentences[i]);
      removed += run - 1;
    } else {
      for (let k = i; k < j; k++) out.push(sentences[k]);
    }
    i = j;
  }
  return { text: out.join(' '), removed };
}

export function collapseRepetitions(utts: Utterance[]): { utterances: Utterance[]; removed: number } {
  const out: Utterance[] = [];
  let removed = 0;
  for (const u of utts) {
    const within = collapseWithin(u.text);
    removed += within.removed;
    const last = out[out.length - 1];
    // Falas consecutivas idênticas do mesmo speaker = loop entre utterances.
    if (last && last.speaker === u.speaker && normSentence(last.text) === normSentence(within.text)) {
      last.end = Math.max(last.end, u.end);
      removed += 1;
      continue;
    }
    out.push({ ...u, text: within.text });
  }
  return { utterances: out, removed };
}
