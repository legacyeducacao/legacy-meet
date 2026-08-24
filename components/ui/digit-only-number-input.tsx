'use client';

﻿import * as React from 'react';
import { cn } from '../../lib/utils';

export interface DigitOnlyNumberInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type' | 'inputMode' | 'pattern'
  > {
  /** Valor controlado. Use string vazia para indicar "sem valor". */
  value: number | '';
  /** Callback disparado quando o valor muda. */
  onChange: (value: number | '') => void;
  /** Valor mÃ­nimo permitido (validado no blur). */
  min?: number;
  /** Valor mÃ¡ximo permitido (validado durante digitaÃ§Ã£o e no blur). */
  max?: number;
  /** Permite valores negativos. Default: false. */
  allowNegative?: boolean;
  className?: string;
}

/**
 * Input numÃ©rico apenas digitÃ¡vel â€” sem setas de incremento, sem scroll,
 * sem drag. Usa <input type="text"> com inputMode="numeric" (forma canÃ´nica
 * em React).
 *
 * Regras:
 * - Filtra caracteres nÃ£o-dÃ­gitos durante a digitaÃ§Ã£o.
 * - Respeita `max` durante a digitaÃ§Ã£o (trunca).
 * - Valida `min` no blur (se valor < min, ajusta para min; se vazio, deixa vazio).
 * - Aceita colar nÃºmeros.
 * - Setas do teclado, scroll do mouse e drag NÃƒO alteram o valor.
 */
const DigitOnlyNumberInput = React.forwardRef<HTMLInputElement, DigitOnlyNumberInputProps>(
  (
    {
      value,
      onChange,
      min,
      max,
      allowNegative = false,
      className,
      onBlur,
      onKeyDown,
      onWheel,
      ...props
    },
    ref,
  ) => {
    const displayValue = value === '' || value === undefined || value === null ? '' : String(value);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === '') {
        onChange('');
        return;
      }
      // Filtra apenas dÃ­gitos (e sinal negativo se permitido)
      const pattern = allowNegative ? /[^0-9-]/g : /[^0-9]/g;
      let cleaned = raw.replace(pattern, '');
      if (allowNegative) {
        // Permite apenas '-' no inÃ­cio
        cleaned = cleaned.replace(/(?!^)-/g, '');
      }
      if (cleaned === '' || cleaned === '-') {
        onChange('');
        return;
      }
      let parsed = parseInt(cleaned, 10);
      if (Number.isNaN(parsed)) {
        onChange('');
        return;
      }
      if (typeof max === 'number' && parsed > max) parsed = max;
      onChange(parsed);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      if (value !== '' && typeof value === 'number') {
        let v = value;
        if (typeof min === 'number' && v < min) v = min;
        if (typeof max === 'number' && v > max) v = max;
        if (v !== value) onChange(v);
      }
      onBlur?.(e);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Bloqueia setas (ArrowUp/ArrowDown) para nÃ£o incrementarem/decrementarem
      // (input type="text" jÃ¡ nÃ£o tem esse comportamento, mas mantemos por garantia)
      onKeyDown?.(e);
    };

    const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
      // Previne que o scroll do mouse altere o valor quando focado
      if (document.activeElement === e.currentTarget) {
        e.currentTarget.blur();
      }
      onWheel?.(e);
    };

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        className={cn(className)}
        {...props}
      />
    );
  },
);

DigitOnlyNumberInput.displayName = 'DigitOnlyNumberInput';

export { DigitOnlyNumberInput };
export default DigitOnlyNumberInput;
