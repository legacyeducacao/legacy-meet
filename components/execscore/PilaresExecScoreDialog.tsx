'use client';

import * as React from 'react';
import { ListChecks } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PilaresForm } from './PilaresForm';
import { fetchPilares, LABEL_ESGOTADO, STATUS_LABEL, type ExecScoreStatus, type PilaresInfo } from '@/lib/execscorePilares';

const STATUS_VARIANT: Record<ExecScoreStatus, 'secondary' | 'default' | 'destructive'> = {
  aguardando: 'secondary',
  processando: 'secondary',
  enviada: 'default',
  erro: 'destructive',
  descartada: 'secondary',
};

/**
 * Detalhe da gravação: o executor responsável (ou admin) revê os pilares do
 * ExecScore depois da reunião. Não aparece para quem não é elegível.
 */
export function PilaresExecScoreButton({ room }: { room: string }) {
  const [info, setInfo] = React.useState<PilaresInfo | null>(null);
  const [open, setOpen] = React.useState(false);
  // Remonta o formulário a cada abertura: começa sempre da escolha salva.
  const [formKey, setFormKey] = React.useState(0);

  const load = React.useCallback(() => {
    fetchPilares(room)
      .then(setInfo)
      .catch(() => setInfo({ elegivel: false, precisaLogin: false }));
  }, [room]);
  React.useEffect(load, [load]);

  if (!info?.elegivel) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <ListChecks className="h-4 w-4" />
        {info.onboarding ? 'No-show e ExecScore' : 'Pilares do ExecScore'}
      </Button>
      {info.noShow ? (
        <Badge variant="destructive">No-show</Badge>
      ) : info.onboarding ? (
        <Badge variant="secondary">Onboarding · fora do ExecScore</Badge>
      ) : (
        info.status && (
          <Badge variant={STATUS_VARIANT[info.status]}>
            {info.status === 'erro' && info.esgotado ? LABEL_ESGOTADO : STATUS_LABEL[info.status]}
          </Badge>
        )
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pilares do ExecScore</DialogTitle>
            <DialogDescription>
              {info.onboarding
                ? 'Reunião de onboarding: não vai para o ExecScore. Aqui você marca ou desfaz o no-show.'
                : 'Desligue os pilares que não foram tratados nesta reunião. Salvar de novo reabre a avaliação e o ExecScore refaz a nota.'}
            </DialogDescription>
          </DialogHeader>
          <PilaresForm
            key={formKey}
            room={room}
            pilares={info.pilares}
            desabilitados={info.desabilitados}
            onboarding={info.onboarding}
            noShow={info.noShow}
            submitLabel="Salvar pilares"
            onSaved={(r) => {
              setOpen(false);
              toast.success(
                r.noShow
                  ? 'No-show registrado. A reunião não vai para o ExecScore.'
                  : info.onboarding
                    ? 'Salvo.'
                    : 'Pilares salvos. A avaliação será refeita no ExecScore.',
              );
              load();
            }}
            onForbidden={() => {
              setOpen(false);
              toast.error('Só o executor responsável pela reunião pode alterar os pilares.');
              load();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
