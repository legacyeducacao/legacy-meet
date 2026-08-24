'use client';

﻿import React, { useState } from 'react';
import { Input } from './input';
import { cn } from '../../lib/utils';
import { parseAmountBR } from '../../lib/parseAmountBR';

/**
 * Campo de valor monetário com máscara.
 *
 * Guarda TEXTO CRU, e não número, de propósito: as telas de Lançamentos e de
 * Contas mostram o `AmbiguousAmountHint` a partir do que foi digitado (o
 * usuário precisa ver que "1.234" pode ser mil duzentos e trinta e quatro ou
 * um vírgula duzentos e trinta e quatro). Converter para número na hora
 * mataria esse aviso.
 *
 * A máscara é aplicada no BLUR, não a cada tecla:
 *  - digitar segue livre, então "1234,56", "1.234,56" e "1234.56" funcionam;
 *  - ao sair do campo o valor aparece formatado (1.234,56), que é o que faltava
 *    e tornava impossível conferir o que tinha sido digitado;
 *  - é o mesmo comportamento dos campos de Estoque, Metas e Acompanhamento —
 *    máscara ao vivo aqui e blur ali seria pior que a inconsistência atual.
 *
 * Locale/símbolo são pt-BR/R$ por padrão (props `locale`/`showSymbol` abaixo
 * plugam outra moeda). No app original (bsc-legacy) isso vem de um sistema de
 * moeda ativa por tenant — `utils/currency.ts` (`getCurrencyLocale`,
 * `getCurrencySymbol`, `getActiveCurrency`) — que não faz parte deste kit por
 * depender de estado global do app; troque `DEFAULT_LOCALE`/`DEFAULT_SYMBOL`
 * abaixo, ou passe `locale`/`symbol` por prop, para plugar o seu.
 */
const DEFAULT_LOCALE = 'pt-BR';
const DEFAULT_SYMBOL = 'R$';

/**
 * Aplica a máscara a um texto digitado. Vazio continua vazio: formatar "" como
 * "0,00" inventaria um valor que ninguém digitou.
 *
 * Exportada porque o campo "Valor" de um formulário não-controlado
 * (react-hook-form `register` + setValueAs, por exemplo) não comporta um
 * input controlado — mas a máscara tem de ser a mesma dos outros campos, não
 * uma segunda implementação.
 */
export function mascararValorMonetario(texto: string, locale: string = DEFAULT_LOCALE): string {
  const limpo = texto.trim();
  if (!limpo) return '';
  // `parseAmountBR` e não um parser genérico: é a MESMA heurística que o
  // restante do formulário usa para SALVAR. Com dois parsers diferentes, a
  // máscara poderia exibir um número e o backend receber outro — a pior falha
  // possível num campo de dinheiro. Texto sem número nenhum volta como está,
  // para não virar 0,00.
  const valor = parseAmountBR(limpo);
  if (valor === null) return texto;
  // Duas casas SEMPRE, e zero exibido como 0,00.
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor);
}

interface MoneyInputProps extends Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  /** Texto cru do campo (ex.: "1.234,56"). */
  value: string;
  onChange: (raw: string) => void;
  /** Prefixo com o símbolo da moeda. Default: `DEFAULT_SYMBOL` ('R$'). */
  showSymbol?: boolean;
  /** Locale usado na máscara do blur (`Intl.NumberFormat`). Default: `DEFAULT_LOCALE` ('pt-BR'). */
  locale?: string;
  /** Símbolo exibido quando `showSymbol`. Default: `DEFAULT_SYMBOL` ('R$'). */
  symbol?: string;
}

export function MoneyInput({
  value,
  onChange,
  showSymbol,
  locale = DEFAULT_LOCALE,
  symbol = DEFAULT_SYMBOL,
  className,
  onBlur,
  onFocus,
  ...rest
}: MoneyInputProps) {
  const [focado, setFocado] = useState(false);

  const campo = (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      value={value}
      placeholder={rest.placeholder ?? '0,00'}
      onChange={(e) => onChange(e.target.value.replace(/[^\d,.-]/g, ''))}
      onFocus={(e) => { setFocado(true); onFocus?.(e); }}
      onBlur={(e) => {
        setFocado(false);
        // Campo vazio continua vazio: formatar "" para "0,00" inventaria um
        // valor que a pessoa não digitou.
        const formatado = mascararValorMonetario(e.target.value, locale);
        if (formatado && formatado !== e.target.value) onChange(formatado);
        onBlur?.(e);
      }}
      className={cn('text-right tabular-nums', showSymbol && 'pl-9', className)}
    />
  );

  if (!showSymbol) return campo;
  return (
    <div className="relative">
      <span className={cn(
        'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium transition-colors',
        focado || value ? 'text-muted-foreground' : 'text-muted-foreground/40',
      )}>
        {symbol}
      </span>
      {campo}
    </div>
  );
}
