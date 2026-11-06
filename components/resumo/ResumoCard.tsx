'use client';

import * as React from 'react';
import { Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { MeetingSummary } from '@/lib/meetingSummaryCore';
import { ResumoReuniao } from './ResumoReuniao';

type Estado =
  | { kind: 'loading' }
  | { kind: 'pronto'; resumo: MeetingSummary | null; podeGerar: boolean }
  | { kind: 'erro' };

/**
 * Bloco "Resumo da reunião" na página da gravação. O resumo nasce sozinho
 * quando a transcrição termina; o botão gera para reuniões antigas ou refaz.
 */
export function ResumoCard({ recordingId, transcricaoPronta }: { recordingId: string; transcricaoPronta: boolean }) {
  const [estado, setEstado] = React.useState<Estado>({ kind: 'loading' });
  const [gerando, setGerando] = React.useState(false);
  const url = `/api/recordings/${encodeURIComponent(recordingId)}/resumo`;

  React.useEffect(() => {
    let cancelado = false;
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const j = (await r.json()) as { resumo: MeetingSummary | null; podeGerar: boolean };
        if (!cancelado) setEstado({ kind: 'pronto', resumo: j.resumo, podeGerar: j.podeGerar });
      })
      .catch(() => !cancelado && setEstado({ kind: 'erro' }));
    return () => {
      cancelado = true;
    };
  }, [url]);

  const gerar = async () => {
    setGerando(true);
    try {
      const r = await fetch(url, { method: 'POST' });
      if (!r.ok) throw new Error((await r.text()) || 'Não foi possível gerar o resumo.');
      const j = (await r.json()) as { resumo: MeetingSummary };
      setEstado({ kind: 'pronto', resumo: j.resumo, podeGerar: true });
      toast.success('Resumo pronto.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o resumo.');
    } finally {
      setGerando(false);
    }
  };

  if (estado.kind === 'erro') return null;
  // Comercial (ou sem IA configurada) e sem resumo guardado: nada a mostrar.
  if (estado.kind === 'pronto' && !estado.resumo && !estado.podeGerar) return null;

  const resumo = estado.kind === 'pronto' ? estado.resumo : null;
  const podeGerar = estado.kind === 'pronto' && estado.podeGerar && transcricaoPronta;

  return (
    <Card className="rounded-xl">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Resumo da reunião
        </CardTitle>
        {resumo && podeGerar && (
          <Button variant="ghost" size="sm" type="button" onClick={gerar} disabled={gerando}>
            {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {gerando ? 'Refazendo…' : 'Refazer'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {estado.kind === 'loading' ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : resumo ? (
          <ResumoReuniao resumo={resumo} />
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              {transcricaoPronta
                ? 'Esta reunião ainda não tem resumo.'
                : 'O resumo aparece aqui quando a transcrição terminar.'}
            </p>
            {podeGerar && (
              <Button type="button" onClick={gerar} disabled={gerando}>
                {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {gerando ? 'Gerando resumo (até 1 minuto)…' : 'Gerar resumo'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
