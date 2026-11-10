'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { diasDaVisao, DIAS_CURTOS, mesmoMes, navegar, tituloPeriodo } from '@/lib/agenda/visao';
import { parseYmd, type Ymd } from '@/lib/agenda-engine';

/** Minicalendário da lateral: navega o mês e escolhe o dia. */
export function MiniCalendario({
  cursor,
  hoje,
  diasVisiveis,
  onEscolher,
}: {
  cursor: Ymd;
  hoje: Ymd;
  diasVisiveis: Ymd[];
  onEscolher: (d: Ymd) => void;
}) {
  const [mes, setMes] = React.useState(cursor);
  React.useEffect(() => setMes(cursor), [cursor]);
  const dias = diasDaVisao('mes', mes);
  const visiveis = new Set(diasVisiveis);

  return (
    <div className="select-none text-sm">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="font-medium">{tituloPeriodo('mes', mes)}</span>
        <div className="flex">
          <button type="button" aria-label="Mês anterior" className="rounded p-1 hover:bg-muted" onClick={() => setMes(navegar('mes', mes, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Próximo mês" className="rounded p-1 hover:bg-muted" onClick={() => setMes(navegar('mes', mes, 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[11px]">
        {DIAS_CURTOS.map((d) => (
          <div key={d} className="py-1 text-muted-foreground">
            {d[0].toUpperCase()}
          </div>
        ))}
        {dias.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onEscolher(d)}
            aria-label={d}
            aria-current={d === hoje ? 'date' : undefined}
            className={cn(
              'mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors hover:bg-muted',
              !mesmoMes(d, mes) && 'text-muted-foreground/60',
              visiveis.has(d) && 'bg-primary/10',
              d === hoje && 'bg-primary font-semibold text-primary-foreground hover:bg-primary/90',
            )}
          >
            {parseYmd(d).day}
          </button>
        ))}
      </div>
    </div>
  );
}
