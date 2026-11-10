'use client';

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DIAS_LONGOS } from '@/lib/agenda/visao';
import type { FaixaExpediente } from '@/lib/agenda-engine';

/** Faixas de expediente por dia da semana (várias por dia, ex.: manhã e tarde). */
export function EditorExpediente({
  valor,
  onChange,
  desabilitado,
}: {
  valor: FaixaExpediente[];
  onChange: (v: FaixaExpediente[]) => void;
  desabilitado?: boolean;
}) {
  const doDia = (d: number) => valor.map((f, i) => ({ f, i })).filter(({ f }) => f.diaSemana === d);
  const mudar = (i: number, campo: 'inicio' | 'fim', v: string) => onChange(valor.map((f, k) => (k === i ? { ...f, [campo]: v } : f)));
  return (
    <div className="divide-y rounded-lg border">
      {[1, 2, 3, 4, 5, 6, 7].map((d) => {
        const faixas = doDia(d);
        return (
          <div key={d} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="w-20 text-sm font-medium capitalize">{DIAS_LONGOS[d - 1]}</span>
            {faixas.length === 0 && <span className="text-sm text-muted-foreground">Sem expediente</span>}
            {faixas.map(({ f, i }) => (
              <span key={i} className="flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-1">
                <Input type="time" step={900} value={f.inicio} disabled={desabilitado} onChange={(e) => mudar(i, 'inicio', e.target.value)} className="h-8 w-[6.5rem]" aria-label={`Início ${DIAS_LONGOS[d - 1]}`} />
                <span className="text-xs text-muted-foreground">às</span>
                <Input type="time" step={900} value={f.fim} disabled={desabilitado} onChange={(e) => mudar(i, 'fim', e.target.value)} className="h-8 w-[6.5rem]" aria-label={`Fim ${DIAS_LONGOS[d - 1]}`} />
                {!desabilitado && (
                  <button type="button" className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Remover faixa" onClick={() => onChange(valor.filter((_, k) => k !== i))}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </span>
            ))}
            {!desabilitado && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange([...valor, { diaSemana: d, inicio: faixas.length ? '13:00' : '08:00', fim: faixas.length ? '18:00' : '12:00' }])}
              >
                <Plus className="h-4 w-4" /> Faixa
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
