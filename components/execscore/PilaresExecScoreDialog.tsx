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
import { fetchPilares, STATUS_LABEL, type ExecScoreStatus, type PilaresInfo } from '@/lib/execscorePilares';

const STATUS_VARIANT: Record<ExecScoreStatus, 'secondary' | 'default' | 'destructive'> = {
  aguardando: 'secondary',
  processando: 'secondary',
  enviada: 'default',
  erro: 'destructive',
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
        Pilares do ExecScore
      </Button>
      {info.status && <Badge variant={STATUS_VARIANT[info.status]}>{STATUS_LABEL[info.status]}</Badge>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pilares do ExecScore</DialogTitle>
            <DialogDescription>
              Desligue os pilares que não foram tratados nesta reunião. Salvar de novo reabre a
              avaliação e o ExecScore refaz a nota.
            </DialogDescription>
          </DialogHeader>
          <PilaresForm
            key={formKey}
            room={room}
            pilares={info.pilares}
            desabilitados={info.desabilitados}
            submitLabel="Salvar pilares"
            onSaved={() => {
              setOpen(false);
              toast.success('Pilares salvos. A avaliação será refeita no ExecScore.');
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
