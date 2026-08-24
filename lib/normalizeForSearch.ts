/**
 * Normalização de texto para BUSCA na interface — minúsculas, sem acento,
 * espaços colapsados.
 *
 * Existe para não haver uma quarta cópia disto no repo: `services/gestao/
 * import/autoMapAccount.ts` e `services/gestao/import/dedupe.ts` já têm
 * versões locais com regras próprias (elas também trocam pontuação por espaço,
 * porque casam palavra-chave em descrição de extrato, não termo digitado). Esta
 * aqui é a de BUSCA: preserva os caracteres, só tira acento e caixa, para que
 * "lancamentos" ache "Lançamentos" e "SERVICO" ache "Serviço".
 */
export function normalizeForSearch(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * O termo digitado aparece em algum dos textos, ignorando acento e caixa?
 *
 * Termo vazio casa com tudo (campo de busca em branco não filtra nada).
 */
export function matchesSearch(query: string, ...haystacks: (string | null | undefined)[]): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  return haystacks.some((h) => normalizeForSearch(h).includes(q));
}
