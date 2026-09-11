import { readFileSync } from 'node:fs';

// Limites do keyterms_prompt da AssemblyAI (Universal-3.5 Pro): até 1000
// termos, no máximo 6 palavras por termo.
export const MAX_KEYTERMS = 1000;
export const MAX_WORDS_PER_KEYTERM = 6;

// Arquivo aceita `{ "keyterms": [...] }` (com comentários em outras chaves) ou
// uma lista simples de strings.
export function parseKeytermsFile(content: string): string[] {
  try {
    const parsed = JSON.parse(content);
    const list = Array.isArray(parsed) ? parsed : parsed?.keyterms;
    return Array.isArray(list) ? list.map((t) => String(t)) : [];
  } catch {
    return [];
  }
}

export function normalizeKeyterms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.trim().replace(/\s+/g, ' ');
    if (!term) continue;
    if (term.split(' ').length > MAX_WORDS_PER_KEYTERM) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}

/** Vocabulário da reunião: termos fixos da Legacy + nomes dos participantes. */
export function buildKeyterms(fixed: string[], participants: string[]): string[] {
  return normalizeKeyterms([...fixed, ...participants]);
}

export function loadKeytermsFile(filePath: string): string[] {
  try {
    return normalizeKeyterms(parseKeytermsFile(readFileSync(filePath, 'utf8')));
  } catch {
    return [];
  }
}
