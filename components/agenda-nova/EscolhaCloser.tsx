'use client';

import * as React from 'react';
import { Label } from '@/components/ui/label';

type OpcaoCloser = { id: string; name: string; livre: boolean | null; motivo?: string | null };

/**
 * Closer responsável (só para o SDR, em reunião do Comercial). Mostra quem
 * está livre no horário; quem já tem reunião aparece como ocupado e não pode
 * ser escolhido. O servidor confere de novo ao salvar.
 */
export function EscolhaCloser({
  inicio,
  fim,
  valor,
  onChange,
  id = 'f-closer',
}: {
  inicio: Date | null;
  fim: Date | null;
  valor: string;
  onChange: (id: string) => void;
  id?: string;
}) {
  const [opcoes, setOpcoes] = React.useState<OpcaoCloser[] | null>(null);
  const ini = inicio?.toISOString() ?? '';
  const fi = fim?.toISOString() ?? '';

  React.useEffect(() => {
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ inicio: ini, fim: fi });
        const res = await fetch(`/api/agenda/closers?${qs}`, { cache: 'no-store', signal: ctrl.signal });
        if (!res.ok) return setOpcoes([]);
        setOpcoes(((await res.json()) as { closers: OpcaoCloser[] }).closers ?? []);
      } catch {
        /* abortado ou sem rede: o servidor confere ao salvar */
      }
    }, 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [ini, fi]);

  // O escolhido ficou ocupado com a troca de horário: limpa a escolha.
  React.useEffect(() => {
    if (valor && opcoes?.some((o) => o.id === valor && o.livre === false)) onChange('');
  }, [opcoes, valor, onChange]);

  const escolhido = opcoes?.find((o) => o.id === valor);
  const livres = opcoes?.filter((o) => o.livre !== false).length ?? 0;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Closer responsável</Label>
      <select
        id={id}
        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        disabled={!opcoes}
      >
        <option value="">{!opcoes ? 'Carregando closers…' : opcoes.length ? 'Escolha o Closer' : 'Nenhum Closer cadastrado'}</option>
        {(opcoes ?? []).map((o) => (
          <option key={o.id} value={o.id} disabled={o.livre === false} title={o.motivo ?? undefined}>
            {o.name}
            {o.livre === false ? ' (ocupado)' : ''}
          </option>
        ))}
      </select>
      {opcoes && opcoes.length > 0 && livres === 0 && (
        <p className="text-xs text-destructive">Todos os Closers estão ocupados neste horário. Escolha outro horário.</p>
      )}
      {escolhido && <p className="text-xs text-muted-foreground">A reunião fica na agenda de {escolhido.name} e você entra como anfitrião.</p>}
    </div>
  );
}
