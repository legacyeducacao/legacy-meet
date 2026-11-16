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

export type PilaresSaved = { desabilitados: string[]; noShow: boolean; onboarding: boolean };

/**
 * Formulário da saída da reunião: primeiro "o cliente compareceu?" (no-show)
 * e, se compareceu, um Switch por pilar (ligado = será avaliado). Reunião de
 * onboarding não tem pilares; a chave de onboarding fica aqui para corrigir
 * uma marcação feita por engano. Usado na tela de saída e no Dialog da gravação.
 */
export function PilaresForm({
  room,
  pilares,
  desabilitados,
  onboarding: onboardingInicial = false,
  noShow: noShowInicial = false,
  submitLabel = 'Confirmar e enviar',
  onSaved,
  onForbidden,
}: {
  room: string;
  pilares: Pilar[];
  /** Escolha salva (null = ainda não escolheu, todos ligados). */
  desabilitados: string[] | null;
  onboarding?: boolean;
  /** A reunião já está marcada como no-show. */
  noShow?: boolean;
  submitLabel?: string;
  onSaved: (r: PilaresSaved) => void;
  /** 403: quem está logado não é o executor responsável. */
  onForbidden: () => void;
}) {
  const [off, setOff] = React.useState<string[]>(() => initialDisabled(desabilitados, pilares));
  const [noShow, setNoShow] = React.useState(noShowInicial);
  const [onboarding, setOnboarding] = React.useState(onboardingInicial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const ligados = pilares.length - off.length;
  const mostraPilares = !noShow && !onboarding;

  const enviar = async () => {
    setBusy(true);
    setError('');
    const r = await savePilares(room, off, { noShow, onboarding });
    setBusy(false);
    if (r.kind === 'ok') onSaved({ desabilitados: off, noShow, onboarding });
    else if (r.kind === 'forbidden') onForbidden();
    else setError(r.message);
  };

  const label = noShow ? 'Confirmar no-show' : onboarding ? 'Concluir' : submitLabel;

  return (
    <div className="space-y-4">
      <div className="flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-2">
        <label htmlFor="pilares-no-show" className="text-sm">
          <span className="font-medium">O cliente não compareceu</span>
          <span className="block text-xs text-muted-foreground">Marca a reunião como no-show</span>
        </label>
        <Switch
          id="pilares-no-show"
          checked={noShow}
          disabled={busy}
          onCheckedChange={setNoShow}
          aria-label="O cliente não compareceu (no-show)"
        />
      </div>

      {!noShow && (
        <div className="flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-2">
          <label htmlFor="pilares-onboarding" className="text-sm">
            <span className="font-medium">Reunião de onboarding</span>
            <span className="block text-xs text-muted-foreground">Primeira reunião do cliente: não vai para o ExecScore</span>
          </label>
          <Switch
            id="pilares-onboarding"
            checked={onboarding}
            disabled={busy}
            onCheckedChange={setOnboarding}
            aria-label="Reunião de onboarding"
          />
        </div>
      )}

      {noShow && (
        <p className="text-sm text-muted-foreground">
          A reunião fica marcada como no-show e não vai para o ExecScore.
        </p>
      )}

      {!noShow && onboarding && (
        <p className="text-sm text-muted-foreground">
          Reunião de onboarding: não vai para o ExecScore. O resumo da reunião fica disponível na
          gravação.
        </p>
      )}

      {mostraPilares && (
        <>
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
        </>
      )}

      {error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button className="h-12 w-full text-base" disabled={busy} onClick={enviar}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? 'Enviando…' : error ? 'Tentar de novo' : label}
      </Button>
    </div>
  );
}
