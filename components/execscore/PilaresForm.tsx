'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  canTurnOff,
  initialDisabled,
  savePilares,
  togglePilar,
  type Pilar,
} from '@/lib/execscorePilares';

/**
 * Formulário dos pilares do ExecScore: um Switch por pilar (ligado = será
 * avaliado) e o botão de enviar. Usado na tela de saída da reunião e no
 * Dialog da gravação.
 */
export function PilaresForm({
  room,
  pilares,
  desabilitados,
  submitLabel = 'Confirmar e enviar',
  onSaved,
  onForbidden,
}: {
  room: string;
  pilares: Pilar[];
  /** Escolha salva (null = ainda não escolheu, todos ligados). */
  desabilitados: string[] | null;
  submitLabel?: string;
  onSaved: (desabilitados: string[]) => void;
  /** 403: quem está logado não é o executor responsável. */
  onForbidden: () => void;
}) {
  const [off, setOff] = React.useState<string[]>(() => initialDisabled(desabilitados, pilares));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const ligados = pilares.length - off.length;

  const enviar = async () => {
    setBusy(true);
    setError('');
    const r = await savePilares(room, off);
    setBusy(false);
    if (r.kind === 'ok') onSaved(off);
    else if (r.kind === 'forbidden') onForbidden();
    else setError(r.message);
  };

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-lg border">
        {pilares.map((p) => {
          const ligado = !off.includes(p.key);
          const travado = ligado && !canTurnOff(off, p.key, pilares);
          const id = `pilar-${p.key}`;
          return (
            <li key={p.key} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
              <label
                htmlFor={id}
                className={ligado ? 'text-sm font-medium' : 'text-sm text-muted-foreground line-through'}
              >
                {p.label}
              </label>
              <Switch
                id={id}
                checked={ligado}
                disabled={busy || travado}
                onCheckedChange={(v) => setOff((cur) => togglePilar(cur, p.key, v, pilares))}
                aria-label={`${p.label}: ${ligado ? 'será avaliado' : 'não será avaliado'}`}
              />
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {ligados === 1
          ? 'Mantenha pelo menos um pilar.'
          : `${ligados} de ${pilares.length} pilares serão avaliados.`}
      </p>

      {error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button className="h-12 w-full text-base" disabled={busy} onClick={enviar}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? 'Enviando…' : error ? 'Tentar de novo' : submitLabel}
      </Button>
    </div>
  );
}
