/**
 * Parse de valores monetários digitados em formato pt-BR (vírgula decimal,
 * ponto como separador de milhar) — usado nos inputs "texto livre" de Contas
 * Legacy (AjustarContaDialog, NovaContaDialog, ConferirPopover,
 * NovaTransferenciaDialog), que antes faziam só
 * `parseFloat(x.replace(',', '.'))` e quebravam em valores com separador de
 * milhar (ex.: "208.170,82" virava 208.17).
 *
 * Heurística:
 * - Tem vírgula → vírgula é o separador decimal; remove TODOS os pontos
 *   (assumidos como separador de milhar) antes de trocar a vírgula por ponto.
 *   Ex.: "208.170,82" -> 208170.82 · "208170,82" -> 208170.82
 * - Sem vírgula, com 2+ pontos → todos os pontos são separador de milhar.
 *   Ex.: "1.234.567" -> 1234567
 * - Sem vírgula, com 1 ponto cujo último grupo tem exatamente 3 dígitos →
 *   ambíguo entre milhar ("1.234") e decimal ("1.5"); tratamos como milhar
 *   SÓ quando o valor tem outro ponto também (ver acima) — com um único
 *   ponto e 3 dígitos à direita mantemos como decimal (heurística mais
 *   simples e previsível: "1234.56" continua sendo 1234.56, não 1234560).
 * - Vazio/whitespace/não numérico → null (sem mutação; caller deve tratar
 *   com toast de erro em vez de gravar 0/NaN).
 */
export function parseAmountBR(input: string): number | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  let normalized: string;

  if (trimmed.includes(',')) {
    // Vírgula presente = separador decimal explícito. Todo ponto restante é
    // separador de milhar — remove antes de trocar a vírgula por ponto.
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(trimmed)) {
    // Sem vírgula, 2+ grupos de exatamente 3 dígitos separados por ponto
    // ("1.234.567") — só faz sentido como separador de milhar. Remove todos.
    normalized = trimmed.replace(/\./g, '');
  } else {
    // 0 ou 1 ponto (ou padrão que não bate com milhar) — caso simples
    // "1234.56" (decimal) ou inteiro. Mantém como está.
    normalized = trimmed;
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Detecta a entrada AMBÍGUA que a heurística de parseAmountBR (por decisão
 * documentada acima — NÃO mude aqui, o pré-fill de edição depende dela e há
 * teste cobrindo o incidente do ConferirPopover) trata como decimal em vez
 * de milhar: um único ponto seguido de EXATAMENTE 3 dígitos, sem vírgula
 * (ex.: "1.500" -> 1,5 · "208.170" -> 208,17). NÃO cobre "1.234.567" (2+
 * grupos, já tratado como milhar sem ambiguidade) nem "1234.56" (2 dígitos
 * finais, decimal inequívoco).
 *
 * Usado pelos inputs de texto livre pra mostrar como o valor foi
 * interpretado ANTES de salvar — nunca bloqueia o envio, só torna a leitura
 * visível pro usuário confirmar (ver AmbiguousAmountHint).
 */
export function isAmbiguousThousandInput(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  return /^-?\d{1,3}\.\d{3}$/.test(raw.trim());
}
