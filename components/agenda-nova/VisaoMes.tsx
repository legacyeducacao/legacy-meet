'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { diffDays, parseYmd, type Ymd } from '@/lib/agenda-engine';
import { DIAS_CURTOS, horaCurta, instanteMin, mesmoMes, minutosNoDia, noDia } from '@/lib/agenda/visao';
import type { EventoDTO, FeriadoDTO } from '@/lib/agenda/tipos';
import type { Ancora } from './Flutuante';

const MAX_POR_DIA = 3;

/**
 * Mês: 6 semanas. Até 3 eventos por dia e "+N mais" (abre o dia). Clique no
 * vazio cria às 09h; arraste um evento para outro dia (mantém o horário).
 */
export function VisaoMes({
  dias,
  cursor,
  hoje,
  tz,
  eventos,
  feriados,
  corDe,
  onCriar,
  onAbrir,
  onMover,
  onVerDia,
}: {
  dias: Ymd[];
  cursor: Ymd;
  hoje: Ymd;
  tz: string;
  eventos: EventoDTO[];
  feriados: FeriadoDTO[];
  corDe: (e: EventoDTO) => string;
  onCriar: (inicio: Date, fim: Date, ancora: Ancora) => void;
  onAbrir: (e: EventoDTO, ancora: Ancora) => void;
  onMover: (e: EventoDTO, inicio: Date, fim: Date) => void;
  onVerDia: (d: Ymd) => void;
}) {
  const feriadoDe = React.useMemo(() => new Map(feriados.map((f) => [f.data, f])), [feriados]);
  const porDia = React.useMemo(
    () => new Map(dias.map((d) => [d, noDia(eventos, d, tz).sort((a, b) => a.inicio.localeCompare(b.inicio))])),
    [dias, eventos, tz],
  );
  const [alvo, setAlvo] = React.useState<Ymd | null>(null);
  const arrastado = React.useRef<EventoDTO | null>(null);

  const soltar = (dia: Ymd) => {
    const ev = arrastado.current;
    arrastado.current = null;
    setAlvo(null);
    if (!ev?.podeEditar) return;
    const diaOrigem = dias.find((d) => noDia([ev], d, tz).length) ?? dia;
    if (diaOrigem === dia) return;
    const desloc = diffDays(diaOrigem, dia) * 86_400_000;
    // Mantém a hora de parede: recalcula pelo fuso (horário de verão).
    const inicio = instanteMin(dia, minutosNoDia(new Date(ev.inicio), diaOrigem, tz), tz);
    const fim = new Date(inicio.getTime() + (Date.parse(ev.fim) - Date.parse(ev.inicio)));
    if (desloc !== 0) onMover(ev, inicio, fim);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-7 border-b bg-card">
        {DIAS_CURTOS.map((d) => (
          <div key={d} className="py-2 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {dias.map((dia) => {
          const evs = porDia.get(dia) ?? [];
          const extra = evs.length - MAX_POR_DIA;
          const feriado = feriadoDe.get(dia);
          return (
            <div
              key={dia}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                onCriar(instanteMin(dia, 9 * 60, tz), instanteMin(dia, 10 * 60, tz), { x: e.clientX, y: e.clientY });
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setAlvo(dia);
              }}
              onDragLeave={() => setAlvo((a) => (a === dia ? null : a))}
              onDrop={(e) => {
                e.preventDefault();
                soltar(dia);
              }}
              className={cn(
                'min-h-0 overflow-hidden border-b border-l p-1',
                !mesmoMes(dia, cursor) && 'bg-muted/30',
                alvo === dia && 'bg-primary/10',
              )}
            >
              <button
                type="button"
                onClick={() => onVerDia(dia)}
                className={cn(
                  'mb-0.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs hover:bg-muted',
                  !mesmoMes(dia, cursor) && 'text-muted-foreground',
                  dia === hoje && 'bg-primary font-semibold text-primary-foreground hover:bg-primary/90',
                )}
              >
                {parseYmd(dia).day}
              </button>
              {feriado && (
                <div className="mb-0.5 truncate rounded bg-red-500/15 px-1 text-[10px] font-medium text-red-700 dark:text-red-300" title={feriado.nome}>
                  {feriado.nome}
                </div>
              )}
              {evs.slice(0, MAX_POR_DIA).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  draggable={e.podeEditar}
                  onDragStart={(ev) => {
                    arrastado.current = e;
                    ev.dataTransfer.effectAllowed = 'move';
                    ev.dataTransfer.setData('text/plain', e.id);
                  }}
                  onClick={(ev) => onAbrir(e, { x: ev.clientX, y: ev.clientY })}
                  className="flex w-full items-center gap-1 truncate rounded px-1 py-px text-left text-[11px] hover:bg-muted"
                  title={e.titulo}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: corDe(e) }} />
                  {!e.diaInteiro && <span className="shrink-0 text-muted-foreground">{horaCurta(new Date(e.inicio), tz)}</span>}
                  <span className={cn('truncate', e.status === 'no_show' && 'line-through')}>
                    {e.rotulo ? `${e.rotulo} · ` : ''}
                    {e.titulo}
                  </span>
                </button>
              ))}
              {extra > 0 && (
                <button type="button" onClick={() => onVerDia(dia)} className="px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                  +{extra} {extra === 1 ? 'outro' : 'outros'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
