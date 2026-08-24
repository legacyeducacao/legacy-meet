'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAppReducedMotion } from '@/lib/useAppReducedMotion';

/**
 * Barra de progresso global no topo (design system Legacy Plan), adaptada ao
 * Next: o sinal de "atividade em voo" é a troca de rota — mostra a barra por
 * um instante a cada navegação (o kit original usava react-query).
 */
export function TopProgressBar() {
  const pathname = usePathname();
  const reduced = useAppReducedMotion();
  const [visible, setVisible] = useState(false);
  const [first, setFirst] = useState(true);

  useEffect(() => {
    if (first) {
      setFirst(false);
      return;
    }
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (reduced) return null;
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[2px] overflow-hidden transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="h-full w-1/3 rounded-r-full bg-primary shadow-[0_0_8px_hsl(var(--primary))] animate-[mi-progress-slide_0.6s_ease-out]" />
    </div>
  );
}
