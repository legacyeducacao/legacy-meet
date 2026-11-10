/** Campos editáveis de um modelo de agenda (só admin altera). */
export const CAMPOS_TEMPLATE = [
  'nome', 'produto', 'duracao_min', 'rrule_padrao', 'hora_padrao', 'sequencia', 'defasagem_padrao', 'entradas_permitidas',
  'politica_feriado', 'encontros_total', 'limite_remarcacoes', 'preparo_min', 'campos_editaveis', 'ativo',
] as const;

export function limparTemplate(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of CAMPOS_TEMPLATE) if (b[k] !== undefined) out[k] = b[k];
  return out;
}
