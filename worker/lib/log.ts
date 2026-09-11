// Timestamp dos logs no horário de São Paulo. Usa toLocaleString com timeZone
// explícito (ICU embutido no Node) — funciona sem tzdata no container.
export const log = (...args: unknown[]) =>
  console.log(new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }), ...args);

/**
 * Log estruturado (uma linha JSON) para eventos que valem acompanhar por
 * reunião: id da gravação, id da transcrição no provider, duração do áudio,
 * tempo de processamento e custo estimado. Fácil de filtrar com grep/jq.
 */
export const logJson = (evt: string, fields: Record<string, unknown>) =>
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      evt,
      ...fields,
    }),
  );

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
