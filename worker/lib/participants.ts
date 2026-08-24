// Lista canônica de participantes para a transcrição. O mesmo participante
// entra por várias fontes (nome digitado no PreJoin, nome do banco, webhook)
// com variações — "MARIZA"/"Mariza", "Matheus Parolini - Legacy"/"Matheus
// Parolini" — e cada variação extra no enum de speakers faz o modelo dividir
// a mesma voz em dois rótulos (troca de interlocutor).
//
// Fonte única: o app importa este arquivo via '@/worker/lib/participants'.

/** Normalização canônica de nomes: sem acentos, minúsculas, espaços colapsados. */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// "Matheus Parolini - Legacy" → "Matheus Parolini" (sufixo de empresa/equipe).
const baseName = (s: string) => s.split(' - ')[0].trim();

/**
 * Mescla nomes deduplicando por caixa/acentos e fundindo variantes com sufixo
 * " - Empresa" (prevalece a forma sem sufixo). Preserva a ordem da primeira
 * ocorrência. Nomes realmente diferentes ("Ana" vs "Ana Paula") não se fundem.
 */
export function mergeParticipants(existing: string[], incoming: string[]): string[] {
  const order: string[] = [];
  const display = new Map<string, string>();
  const hasClean = new Map<string, boolean>();
  for (const raw of [...existing, ...incoming]) {
    const name = (raw ?? '').trim();
    if (!name) continue;
    const key = norm(baseName(name));
    if (!key) continue;
    const isClean = name === baseName(name);
    if (!display.has(key)) {
      order.push(key);
      display.set(key, name);
      hasClean.set(key, isClean);
    } else if (isClean && !hasClean.get(key)) {
      display.set(key, name);
      hasClean.set(key, true);
    }
  }
  return order.map((k) => display.get(k) as string);
}
