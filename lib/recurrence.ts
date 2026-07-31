export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface RecurrenceInput {
  frequency: Frequency;
  /** Término por data (inclusivo). Exclusivo com `count`. */
  until?: Date;
  /** Término por nº de ocorrências (1ª inclusa). Exclusivo com `until`. */
  count?: number;
}

export const MAX_OCCURRENCES = 104;

// America/Sao_Paulo é UTC-3 fixo (sem horário de verão desde 2019) — offset
// constante permite aritmética de datas sem biblioteca de timezone.
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Soma `months` meses preservando o horário e ancorando no dia do mês da
// primeira ocorrência: 31 vira 30/28 em mês curto e VOLTA a 31 quando o mês
// seguinte permite.
function addMonthsClamped(start: Date, months: number, anchorDay: number): Date {
  const local = new Date(start.getTime() - TZ_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(anchorDay, lastDay);
  const res = Date.UTC(
    y,
    m,
    day,
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  );
  return new Date(res + TZ_OFFSET_MS);
}

/**
 * Calcula as datas de uma série recorrente a partir da primeira ocorrência.
 * Lança Error (mensagem pt-BR, própria para exibir ao usuário) em regra
 * inválida ou quando a regra estoura MAX_OCCURRENCES.
 */
export function computeOccurrences(start: Date, rec: RecurrenceInput): Date[] {
  const hasUntil = rec.until instanceof Date && !isNaN(rec.until.getTime());
  const hasCount = typeof rec.count === 'number' && Number.isFinite(rec.count);
  if (hasUntil === hasCount) {
    throw new Error('Informe o término por data OU por número de vezes (apenas um dos dois).');
  }
  if (hasCount && ((rec.count as number) < 1 || (rec.count as number) > MAX_OCCURRENCES)) {
    throw new Error(`O número de ocorrências deve estar entre 1 e ${MAX_OCCURRENCES}.`);
  }

  const stepDays = rec.frequency === 'daily' ? 1 : rec.frequency === 'weekly' ? 7 : 14;
  const anchorDay = new Date(start.getTime() - TZ_OFFSET_MS).getUTCDate();
  const out: Date[] = [];

  for (let i = 0; ; i++) {
    const next =
      rec.frequency === 'monthly'
        ? addMonthsClamped(start, i, anchorDay)
        : new Date(start.getTime() + i * stepDays * DAY_MS);
    if (hasCount && out.length >= (rec.count as number)) break;
    if (hasUntil && next.getTime() > (rec.until as Date).getTime()) break;
    if (out.length >= MAX_OCCURRENCES) {
      throw new Error(
        `A regra geraria mais de ${MAX_OCCURRENCES} reuniões — reduza o período ou a frequência.`,
      );
    }
    out.push(next);
  }
  return out;
}
