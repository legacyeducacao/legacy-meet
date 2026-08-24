'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * Número que "conta" até o valor com easing — para KPIs e contadores.
 * Anima só quando `value` MUDA (primeiro render parte de 0→value uma vez);
 * com prefers-reduced-motion mostra o valor direto.
 * Ao retarget, continua do valor exibido (sem salto).
 */
export interface NumberTickerProps {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export const NumberTicker: React.FC<NumberTickerProps> = ({ value, format, durationMs = 600, className }) => {
  const reduced = useReducedMotion();
  const shownRef = useRef(0);
  const [shown, setShown] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) { setShown(value); shownRef.current = value; return; }
    const from = shownRef.current;
    if (from === value) { setShown(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const next = from + (value - from) * easeOut(p);
      shownRef.current = next;
      setShown(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs, reduced]);

  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString('pt-BR'));
  return <span className={className}>{fmt(reduced ? value : shown)}</span>;
};
