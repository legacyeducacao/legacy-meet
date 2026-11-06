'use client';

import * as React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PilaresForm } from '@/components/execscore/PilaresForm';
import { fetchPilares, type PilaresInfo } from '@/lib/execscorePilares';
import { ThanksCard } from './ThanksCard';

/**
 * Saída do anfitrião: se a reunião é da Executoria e quem saiu é o executor
 * responsável, ele escolhe os pilares que foram tratados e a transcrição segue
 * sozinha para o ExecScore. Para qualquer outro caso, o agradecimento de sempre.
 */
export function PilaresExecScore({ room }: { room: string }) {
  const [info, setInfo] = React.useState<PilaresInfo | 'loading'>('loading');
  const [done, setDone] = React.useState(false);
  const [forbidden, setForbidden] = React.useState(false);
  const [loginHref, setLoginHref] = React.useState<string | undefined>();

  React.useEffect(() => {
    let cancelled = false;
    fetchPilares(room)
      .then((r) => {
        if (cancelled) return;
        // Volta para esta mesma tela depois do login (/login?next=, ver lib/safeNext).
        if (!r.elegivel && r.precisaLogin) {
          setLoginHref(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        }
        setInfo(r);
      })
      .catch(() => !cancelled && setInfo({ elegivel: false, precisaLogin: false }));
    return () => {
      cancelled = true;
    };
  }, [room]);

  if (info === 'loading') {
    return (
      <Card className="m-auto w-full max-w-md" aria-busy="true" aria-label="Carregando">
        <CardContent className="space-y-4 py-8">
          <Skeleton className="mx-auto h-7 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!info.elegivel || forbidden) return <ThanksCard loginHref={forbidden ? undefined : loginHref} />;

  if (done) {
    return (
      <Card className="m-auto w-full max-w-md text-center">
        <CardContent className="flex flex-col items-center gap-4 py-10">
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <h1 className="text-2xl font-bold">Pronto!</h1>
          <p className="text-muted-foreground">
            Assim que a transcrição terminar, a avaliação aparece no seu ExecScore.
          </p>
          <p className="text-sm text-muted-foreground">Você já pode fechar esta janela.</p>
        </CardContent>
      </Card>
    );
  }

  const detalhes = [info.titulo, info.cliente].filter((s): s is string => !!s?.trim());
  return (
    <Card className="m-auto w-full max-w-md">
      <CardContent className="space-y-5 px-5 py-6 sm:px-6 sm:py-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Reunião encerrada</h1>
          {detalhes.length > 0 && (
            <p className="text-sm font-medium">{detalhes.join(' · ')}</p>
          )}
          <p className="text-sm text-muted-foreground">
            Desligue os pilares que não foram tratados nesta reunião. A transcrição vai sozinha para
            o seu ExecScore.
          </p>
        </div>
        <PilaresForm
          room={room}
          pilares={info.pilares}
          desabilitados={info.desabilitados}
          onSaved={() => setDone(true)}
          onForbidden={() => setForbidden(true)}
        />
      </CardContent>
    </Card>
  );
}
