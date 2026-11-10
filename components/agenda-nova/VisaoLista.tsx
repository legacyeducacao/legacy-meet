'use client';

import * as React from 'react';
import { CalendarX2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Ymd } from '@/lib/agenda-engine';
import { faixaHorario, noDia, rotuloDia } from '@/lib/agenda/visao';
import type { EventoDTO, FeriadoDTO } from '@/lib/agenda/tipos';
import type { Ancora } from './Flutuante';

/** Lista corrida (agenda) dos próximos dias, agrupada por dia. */
export function VisaoLista({
  dias,
  hoje,
  tz,
  eventos,
  feriados,
  corDe,
  onAbrir,
}: {
  dias: Ymd[];
  hoje: Ymd;
  tz: string;
  eventos: EventoDTO[];
  feriados: FeriadoDTO[];
  corDe: (e: EventoDTO) => string;
  onAbrir: (e: EventoDTO, ancora: Ancora) => void;
}) {
  const feriadoDe = new Map(feriados.map((f) => [f.data, f]));
  const grupos = dias
    .map((d) => ({ dia: d, eventos: noDia(eventos, d, tz).sort((a, b) => a.inicio.localeCompare(b.inicio)), feriado: feriadoDe.get(d) }))
    .filter((g) => g.eventos.length || g.feriado);

  if (!grupos.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
        <CalendarX2 className="h-10 w-10" />
        <p>Nada marcado nos próximos 30 dias.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {grupos.map((g) => (
        <section key={g.dia} className="border-b px-3 py-3 sm:px-6">
          <h3 className={cn('mb-2 text-sm font-semibold first-letter:uppercase', g.dia === hoje && 'text-primary')}>
            {g.dia === hoje ? 'hoje, ' : ''}
            {rotuloDia(g.dia)}
            {g.feriado && <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">{g.feriado.nome}</span>}
          </h3>
          <ul className="space-y-1">
            {g.eventos.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={(ev) => onAbrir(e, { x: ev.clientX, y: ev.clientY })}
                  className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
                >
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: corDe(e) }} />
                  <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">
                    {e.diaInteiro ? 'Dia todo' : faixaHorario(new Date(e.inicio), new Date(e.fim), tz)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm font-medium', e.status === 'no_show' && 'line-through')}>
                      {e.rotulo && <span className="mr-1 rounded bg-muted px-1 text-xs">{e.rotulo}</span>}
                      {e.titulo}
                    </span>
                    {(e.cliente || e.turma || e.executorNome) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {[e.cliente || e.turma, e.executorNome].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
