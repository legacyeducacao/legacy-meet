'use client';

import * as React from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { MeetingSummary } from '@/lib/meetingSummaryCore';
import { ResumoReuniao } from './ResumoReuniao';
import { BaixarPdfButton } from './BaixarPdfButton';

/**
 * Agenda: antes de uma reunião da Executoria, o executor abre o resumo da
 * última reunião com o mesmo cliente para saber o que retomar.
 */
export function UltimaReuniaoButton({ meetingId, clientName }: { meetingId: string; clientName: string | null }) {
  const [open, setOpen] = React.useState(false);
  const [estado, setEstado] = React.useState<'loading' | 'erro' | { resumo: MeetingSummary | null }>('loading');

  React.useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setEstado('loading');
    fetch(`/api/meetings/${encodeURIComponent(meetingId)}/resumo-anterior`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const j = (await r.json()) as { resumo: MeetingSummary | null };
        if (!cancelado) setEstado({ resumo: j.resumo });
      })
      .catch(() => !cancelado && setEstado('erro'));
    return () => {
      cancelado = true;
    };
  }, [open, meetingId]);

  const resumo = typeof estado === 'object' ? estado.resumo : null;
  const gravacao = resumo?.recordingIds?.[0];

  return (
    <>
      <Button variant="outline" size="sm" type="button" onClick={() => setOpen(true)}>
        <History className="h-4 w-4" />
        Última reunião
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Última reunião{clientName ? ` com ${clientName}` : ''}</DialogTitle>
            <DialogDescription>
              {resumo
                ? [resumo.title, resumo.meetingDate, resumo.executorName].filter(Boolean).join(' · ')
                : 'Resumo da reunião anterior com este cliente.'}
            </DialogDescription>
          </DialogHeader>
          {estado === 'loading' ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : estado === 'erro' ? (
            <p className="text-sm text-destructive">Não foi possível carregar o resumo agora.</p>
          ) : resumo ? (
            <div className="space-y-4">
              <ResumoReuniao resumo={resumo} />
              <div className="flex flex-wrap gap-2">
                {gravacao && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/gravacoes/${encodeURIComponent(gravacao)}`}>Abrir a gravação</Link>
                  </Button>
                )}
                <BaixarPdfButton resumo={resumo} variant="outline" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ainda não há resumo de uma reunião anterior com este cliente. Os resumos começam a ser
              gerados nas reuniões transcritas a partir de agora.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
